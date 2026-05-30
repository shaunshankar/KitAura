import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { scanReceipt, fileToBase64 } from '../lib/claude'
import Modal from '../components/Modal'
import { format, parseISO, startOfMonth, endOfMonth, startOfWeek, addDays } from 'date-fns'
import './GrocerySpend.css'

const blankForm = { date: format(new Date(), 'yyyy-MM-dd'), total: '', store: '', item_count: '', notes: '' }

function buildWeeklyBars(records) {
  const now = new Date()
  const mStart = startOfMonth(now)
  const mEnd = endOfMonth(now)
  const weeks = []
  let cursor = startOfWeek(mStart, { weekStartsOn: 1 })
  while (cursor <= mEnd) {
    const wEnd = addDays(cursor, 6)
    const label = `${format(cursor, 'MMM d')}–${format(wEnd, 'd')}`
    const total = records
      .filter(r => r.date >= format(cursor, 'yyyy-MM-dd') && r.date <= format(wEnd, 'yyyy-MM-dd'))
      .reduce((s, r) => s + r.total, 0)
    weeks.push({ label, total })
    cursor = addDays(cursor, 7)
  }
  return weeks
}

export default function GrocerySpend({ user }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editRecord, setEditRecord] = useState(null)
  const [form, setForm] = useState(blankForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [profile, setProfile] = useState(null)

  // ── Restock from receipt ─────────────────────────────────────────
  const [showRestockModal, setShowRestockModal] = useState(false)
  const [restockMatches, setRestockMatches] = useState([])
  const [pendingTripData, setPendingTripData] = useState(null)
  const [restocking, setRestocking] = useState(false)

  useEffect(() => { loadProfile() }, [user])
  useEffect(() => { if (profile !== undefined) loadRecords() }, [profile])

  async function loadProfile() {
    const { data } = await supabase.from('user_profiles').select('household_id').eq('id', user.id).single()
    setProfile(data)
  }

  const loadRecords = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('grocery_spend').select('*').order('date', { ascending: false })
    if (profile?.household_id) query = query.eq('household_id', profile.household_id)
    else query = query.eq('created_by', user.id)
    const { data } = await query
    setRecords(data || [])
    setLoading(false)
  }, [user.id, profile])

  function openAdd(prefill = {}) {
    setEditRecord(null)
    setForm({ ...blankForm, ...prefill })
    setError('')
    setShowModal(true)
  }

  function openEdit(record) {
    setEditRecord(record)
    setForm({ date: record.date, total: record.total, store: record.store || '',
      item_count: record.item_count || '', notes: record.notes || '' })
    setError('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.total || isNaN(Number(form.total))) { setError('Total amount is required'); return }
    if (!form.date) { setError('Date is required'); return }
    setSaving(true)
    setError('')
    const payload = {
      date: form.date, total: Number(form.total), store: form.store || null,
      item_count: form.item_count ? Number(form.item_count) : null,
      notes: form.notes || null, created_by: user.id,
      household_id: profile?.household_id || null,
    }
    let err
    if (editRecord) {
      ;({ error: err } = await supabase.from('grocery_spend').update(payload).eq('id', editRecord.id))
    } else {
      ;({ error: err } = await supabase.from('grocery_spend').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowModal(false)
    loadRecords()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this record?')) return
    await supabase.from('grocery_spend').delete().eq('id', id)
    loadRecords()
  }

  async function handleScanFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setScanError('')
    setScanLoading(true)
    try {
      const base64 = await fileToBase64(file)
      const result = await scanReceipt(base64, file.type)

      const tripData = {
        store:      result.store      || '',
        total:      result.total      != null ? String(result.total)      : '',
        date:       result.date       || format(new Date(), 'yyyy-MM-dd'),
        item_count: result.item_count != null ? String(result.item_count) : '',
      }

      // Try to match receipt items against inventory
      const receiptItems = result.items || []
      if (receiptItems.length > 0) {
        let invQuery = supabase.from('inventory_items').select('id,name,quantity,unit,category')
        if (profile?.household_id) invQuery = invQuery.eq('household_id', profile.household_id)
        else invQuery = invQuery.eq('created_by', user.id)
        const { data: inv } = await invQuery

        const matches = []
        for (const ri of receiptItems) {
          const riLower = ri.name.toLowerCase()
          const match = (inv || []).find(i => {
            const iLower = i.name.toLowerCase()
            return iLower.includes(riLower) || riLower.includes(iLower)
          })
          if (match && !matches.find(m => m.inventoryId === match.id)) {
            matches.push({
              inventoryId:   match.id,
              inventoryName: match.name,
              unit:          match.unit,
              quantity:      ri.quantity || 1,
              selected:      true,
            })
          }
        }

        if (matches.length > 0) {
          setPendingTripData(tripData)
          setRestockMatches(matches)
          setShowRestockModal(true)
          return // Trip form opens after restock modal
        }
      }

      openAdd(tripData)
    } catch (err) {
      setScanError(err.message)
    } finally {
      setScanLoading(false)
    }
  }

  async function confirmRestockFromReceipt() {
    setRestocking(true)
    const toUpdate = restockMatches.filter(m => m.selected)
    await Promise.all(
      toUpdate.map(m =>
        supabase.from('inventory_items')
          .update({ quantity: Number(m.quantity), updated_at: new Date().toISOString() })
          .eq('id', m.inventoryId)
      )
    )
    setRestocking(false)
    setShowRestockModal(false)
    setRestockMatches([])
    if (pendingTripData) {
      openAdd(pendingTripData)
      setPendingTripData(null)
    }
  }

  function skipRestock() {
    setShowRestockModal(false)
    setRestockMatches([])
    if (pendingTripData) {
      openAdd(pendingTripData)
      setPendingTripData(null)
    }
  }

  // ── Stats ────────────────────────────────────────────────────────
  const now = new Date()
  const thisMonthStart = format(startOfMonth(now), 'yyyy-MM-dd')
  const thisMonthEnd   = format(endOfMonth(now), 'yyyy-MM-dd')
  const thisMonth      = records.filter(r => r.date >= thisMonthStart && r.date <= thisMonthEnd)
  const thisMonthTotal = thisMonth.reduce((s, r) => s + r.total, 0)
  const allTimeTotal   = records.reduce((s, r) => s + r.total, 0)
  const avgPerTrip     = records.length > 0 ? allTimeTotal / records.length : 0

  const weeklyBars = buildWeeklyBars(thisMonth)
  const maxWeekly  = Math.max(...weeklyBars.map(w => w.total), 1)

  const grouped = {}
  records.forEach(r => {
    const key = format(parseISO(r.date), 'MMMM yyyy')
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(r)
  })

  if (loading) {
    return <div className="loading-state"><span className="spinner" /> Loading…</div>
  }

  return (
    <div className="spend-page">
      <div className="page-header">
        <h1>Grocery Spend</h1>
        <div className="page-header-actions">
          <label className={'btn btn-ghost' + (scanLoading ? ' disabled' : '')}>
            {scanLoading ? <><span className="spinner" /> Scanning…</> : '📷 Scan Receipt'}
            <input type="file" accept="image/*" capture="environment" onChange={handleScanFile} style={{ display: 'none' }} disabled={scanLoading} />
          </label>
          <button className="btn btn-primary" onClick={() => openAdd()}>+ Add Trip</button>
        </div>
      </div>

      {scanError && <div className="error-msg">{scanError}</div>}

      {records.length === 0 ? (
        /* ── Empty onboarding ── */
        <div className="spend-onboarding">
          <div className="spend-onboarding-text">
            <h2>Start tracking your grocery spending</h2>
            <p>See how much you spend each week and month, spot trends, and stay on budget. The fastest way to get started is to scan a receipt.</p>
          </div>
          <label className={'spend-scan-cta' + (scanLoading ? ' disabled' : '')}>
            {scanLoading
              ? <><span className="spinner" style={{ borderTopColor: '#fff' }} /> Scanning receipt…</>
              : <><span className="spend-scan-icon">📷</span><div><strong>Scan a Receipt</strong><p>Point your camera at any grocery receipt and AI will extract the details automatically.</p></div></>}
            <input type="file" accept="image/*" capture="environment" onChange={handleScanFile} style={{ display: 'none' }} disabled={scanLoading} />
          </label>
          <button className="btn btn-ghost" onClick={() => openAdd()}>Or add a trip manually →</button>
        </div>
      ) : (
        <>
          <div className="stats-row">
            <div className="stat-card">
              <div className="stat-label">This Month</div>
              <div className="stat-value">${thisMonthTotal.toFixed(2)}</div>
              <div className="stat-sub">{thisMonth.length} trip{thisMonth.length !== 1 ? 's' : ''}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Avg Per Trip</div>
              <div className="stat-value">${avgPerTrip.toFixed(2)}</div>
              <div className="stat-sub">all time</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">All Time</div>
              <div className="stat-value">${allTimeTotal.toFixed(2)}</div>
              <div className="stat-sub">{records.length} total trips</div>
            </div>
          </div>

          {/* ── Weekly bar chart ── */}
          {thisMonth.length > 0 && (
            <div className="spend-chart card">
              <div className="spend-chart-header">
                <h3 className="spend-chart-title">{format(now, 'MMMM')} — Weekly Breakdown</h3>
                <span className="spend-chart-total">${thisMonthTotal.toFixed(2)} total</span>
              </div>
              <div className="bar-chart">
                {weeklyBars.map((week, i) => (
                  <div key={i} className="bar-col">
                    <div className="bar-value-label">{week.total > 0 ? `$${week.total.toFixed(0)}` : ''}</div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ height: `${week.total > 0 ? Math.max(4, (week.total / maxWeekly) * 100) : 0}%` }}
                      />
                    </div>
                    <div className="bar-week-label">{week.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Records by month ── */}
          <div className="spend-months">
            {Object.entries(grouped).map(([month, monthRecords]) => {
              const monthTotal = monthRecords.reduce((s, r) => s + r.total, 0)
              return (
                <div key={month} className="spend-month">
                  <div className="spend-month-header">
                    <span className="spend-month-name">{month}</span>
                    <span className="spend-month-total">${monthTotal.toFixed(2)}</span>
                  </div>
                  {monthRecords.map(record => (
                    <div key={record.id} className="spend-record">
                      <div className="spend-record-info">
                        <span className="spend-record-store">{record.store || 'Unknown store'}</span>
                        <div className="spend-record-meta">
                          <span>{format(parseISO(record.date), 'MMM d, yyyy')}</span>
                          {record.item_count && <span>· {record.item_count} items</span>}
                          {record.notes && <span>· {record.notes}</span>}
                        </div>
                      </div>
                      <div className="spend-record-right">
                        <span className="spend-record-total">${record.total.toFixed(2)}</span>
                        <div className="spend-record-actions">
                          <button className="btn-icon" onClick={() => openEdit(record)}>✏️</button>
                          <button className="btn-icon danger" onClick={() => handleDelete(record.id)}>🗑️</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Restock from receipt modal ── */}
      <Modal isOpen={showRestockModal} onClose={skipRestock} title="Restock inventory from receipt?">
        <p className="restock-modal-intro">
          We found <strong>{restockMatches.length} item{restockMatches.length !== 1 ? 's' : ''}</strong> from your receipt in your inventory.
          Update their quantities to reflect what you bought?
        </p>
        <div className="restock-matches">
          {restockMatches.map((m, i) => (
            <div key={i} className="restock-match-row">
              <input
                type="checkbox"
                checked={m.selected}
                onChange={e => setRestockMatches(prev =>
                  prev.map((r, j) => j === i ? { ...r, selected: e.target.checked } : r)
                )}
              />
              <span className="restock-match-name">{m.inventoryName}</span>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={m.quantity}
                className="restock-match-qty"
                onChange={e => setRestockMatches(prev =>
                  prev.map((r, j) => j === i ? { ...r, quantity: Number(e.target.value) } : r)
                )}
              />
              <span className="restock-match-unit">{m.unit}</span>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={skipRestock}>Skip</button>
          <button
            className="btn btn-primary"
            onClick={confirmRestockFromReceipt}
            disabled={restocking || !restockMatches.some(m => m.selected)}
          >
            {restocking ? <span className="spinner" /> : null}
            Update {restockMatches.filter(m => m.selected).length} item{restockMatches.filter(m => m.selected).length !== 1 ? 's' : ''}
          </button>
        </div>
      </Modal>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editRecord ? 'Edit Trip' : 'Add Grocery Trip'}>
        {error && <div className="error-msg">{error}</div>}
        <div className="form-row">
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Total ($)</label>
            <input type="number" min="0" step="0.01" value={form.total} onChange={e => setForm(f => ({ ...f, total: e.target.value }))} placeholder="0.00" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Store</label>
            <input value={form.store} onChange={e => setForm(f => ({ ...f, store: e.target.value }))} placeholder="e.g. Whole Foods" />
          </div>
          <div className="form-group">
            <label>Item Count</label>
            <input type="number" min="0" value={form.item_count} onChange={e => setForm(f => ({ ...f, item_count: e.target.value }))} placeholder="Optional" />
          </div>
        </div>
        <div className="form-group">
          <label>Notes</label>
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            {editRecord ? 'Save Changes' : 'Add Trip'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
