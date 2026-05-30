import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { scanInventory, fileToBase64 } from '../lib/claude'
import Modal from '../components/Modal'
import './Inventory.css'

const CATEGORIES = ['produce','dairy','meat','grains','canned','frozen','beverages','snacks','condiments','bakery','other']
const LOCATIONS = ['pantry','fridge','freezer']
const UNITS = ['unit','g','kg','ml','L','oz','lb','cup','tbsp','tsp','pack','bunch','can','bottle','box']

const blankItem = {
  name: '', category: 'other', location: 'pantry',
  quantity: 1, unit: 'unit', low_threshold: 1,
  expiry_date: '', is_fresh_produce: false, notes: '',
}

function getExpiryStatus(item) {
  if (!item.expiry_date) return null
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const exp = new Date(item.expiry_date); exp.setHours(0, 0, 0, 0)
  const diff = Math.floor((exp - now) / 86400000)
  if (diff <= 0) return 'expired'
  if (diff <= 3) return 'soon'
  if (diff <= 7) return 'week'
  return null
}

function formatExpiry(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Inventory({ user }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('pantry')
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(blankItem)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')
  const [scannedItems, setScannedItems] = useState(null)
  const [showScanModal, setShowScanModal] = useState(false)
  const [addingScanned, setAddingScanned] = useState(false)
  const [profile, setProfile] = useState(null)
  const [addedToList, setAddedToList] = useState(new Set())
  const [restockItem, setRestockItem] = useState(null) // { id, qty }
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)

  useEffect(() => { loadProfile() }, [user])
  useEffect(() => { if (profile !== undefined) loadItems() }, [profile])
  useEffect(() => { setSearch(''); setFilterCategory('') }, [activeTab])

  async function loadProfile() {
    const { data } = await supabase.from('user_profiles').select('household_id').eq('id', user.id).single()
    setProfile(data)
  }

  const loadItems = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('inventory_items').select('*').order('name')
    if (profile?.household_id) query = query.eq('household_id', profile.household_id)
    else query = query.eq('created_by', user.id)
    const { data } = await query
    setItems(data || [])
    setLoading(false)
  }, [user.id, profile])

  function openAdd() {
    setEditItem(null)
    setForm({ ...blankItem, location: activeTab === 'expiring' ? 'pantry' : activeTab })
    setError('')
    setShowModal(true)
  }

  function openEdit(item) {
    setEditItem(item)
    setForm({
      name: item.name, category: item.category, location: item.location,
      quantity: item.quantity, unit: item.unit, low_threshold: item.low_threshold,
      expiry_date: item.expiry_date || '', is_fresh_produce: item.is_fresh_produce,
      notes: item.notes || '',
    })
    setError('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    const payload = {
      ...form, quantity: Number(form.quantity), low_threshold: Number(form.low_threshold),
      expiry_date: form.expiry_date || null, created_by: user.id,
      household_id: profile?.household_id || null,
    }
    let err
    if (editItem) {
      ;({ error: err } = await supabase.from('inventory_items').update(payload).eq('id', editItem.id))
    } else {
      ;({ error: err } = await supabase.from('inventory_items').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowModal(false)
    loadItems()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this item?')) return
    await supabase.from('inventory_items').delete().eq('id', id)
    loadItems()
  }

  async function markAsLow(item) {
    const isAlreadyLow = item.quantity <= item.low_threshold

    // If not already low, drop the quantity to the low threshold
    if (!isAlreadyLow) {
      const newQty = Math.max(0, item.low_threshold)
      await supabase
        .from('inventory_items')
        .update({ quantity: newQty, updated_at: new Date().toISOString() })
        .eq('id', item.id)
    }

    // Check if already on the shopping list (unpurchased, same name)
    let shopQuery = supabase
      .from('shopping_list_items')
      .select('id')
      .ilike('name', item.name)
      .eq('is_purchased', false)
    if (profile?.household_id) {
      shopQuery = shopQuery.eq('household_id', profile.household_id)
    } else {
      shopQuery = shopQuery.eq('created_by', user.id)
    }
    const { data: existing } = await shopQuery.limit(1)

    if (!existing?.length) {
      await supabase.from('shopping_list_items').insert({
        name: item.name,
        quantity: 1,
        unit: item.unit || 'unit',
        category: item.category || 'other',
        auto_added: true,
        created_by: user.id,
        household_id: profile?.household_id || null,
      })
    }

    // Show feedback on the card
    setAddedToList(prev => new Set(prev).add(item.id))
    setTimeout(() => {
      setAddedToList(prev => { const next = new Set(prev); next.delete(item.id); return next })
    }, 2500)

    // Reload so the Low badge updates if quantity changed
    if (!isAlreadyLow) loadItems()
  }

  function toggleSelect(id) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === tabItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(tabItems.map(i => i.id)))
    }
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
  }

  async function bulkMarkAsLow() {
    if (!selectedIds.size) return
    setBulkWorking(true)

    const targets = tabItems.filter(i => selectedIds.has(i.id))

    // Update quantities for items not already low
    await Promise.all(
      targets
        .filter(i => i.quantity > i.low_threshold)
        .map(i =>
          supabase.from('inventory_items')
            .update({ quantity: Math.max(0, i.low_threshold), updated_at: new Date().toISOString() })
            .eq('id', i.id)
        )
    )

    // Bulk-add to shopping list — skip any already there
    const hhId = profile?.household_id
    let shopQuery = supabase.from('shopping_list_items').select('name').eq('is_purchased', false)
    shopQuery = hhId ? shopQuery.eq('household_id', hhId) : shopQuery.eq('created_by', user.id)
    const { data: existing } = await shopQuery
    const existingNames = new Set((existing || []).map(e => e.name.toLowerCase()))

    const toAdd = targets.filter(i => !existingNames.has(i.name.toLowerCase()))
    if (toAdd.length) {
      await supabase.from('shopping_list_items').insert(
        toAdd.map(i => ({
          name: i.name,
          quantity: 1,
          unit: i.unit || 'unit',
          category: i.category || 'other',
          auto_added: true,
          created_by: user.id,
          household_id: hhId || null,
        }))
      )
    }

    setBulkWorking(false)
    exitSelectMode()
    loadItems()
  }

  async function confirmRestock(item) {
    const qty = Number(restockItem?.qty)
    if (!qty || qty <= 0) return
    await supabase
      .from('inventory_items')
      .update({ quantity: qty, updated_at: new Date().toISOString() })
      .eq('id', item.id)
    setRestockItem(null)
    loadItems()
  }

  async function handleScanFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setScanError('')
    setScanLoading(true)
    try {
      const base64 = await fileToBase64(file)
      const results = await scanInventory(base64, file.type)
      setScannedItems(results.map(r => ({ ...r, selected: true })))
      setShowScanModal(true)
    } catch (err) {
      setScanError(err.message)
    } finally {
      setScanLoading(false)
    }
  }

  async function addScannedItems() {
    const toAdd = scannedItems.filter(i => i.selected)
    if (!toAdd.length) return
    setAddingScanned(true)
    await supabase.from('inventory_items').insert(
      toAdd.map(i => ({
        name: i.name, category: i.category || 'other',
        location: i.location || (activeTab === 'expiring' ? 'pantry' : activeTab),
        quantity: Number(i.quantity) || 1, unit: i.unit || 'unit', low_threshold: 1,
        created_by: user.id, household_id: profile?.household_id || null,
      }))
    )
    setAddingScanned(false)
    setShowScanModal(false)
    setScannedItems(null)
    loadItems()
  }

  // ── Derived ──────────────────────────────────────────────────────
  const counts = { pantry: 0, fridge: 0, freezer: 0 }
  items.forEach(i => { counts[i.location] = (counts[i.location] || 0) + 1 })

  const expiringTabItems = [...items]
    .filter(i => i.expiry_date)
    .sort((a, b) => new Date(a.expiry_date) - new Date(b.expiry_date))

  const baseTabItems = activeTab === 'expiring'
    ? expiringTabItems
    : items.filter(i => i.location === activeTab)

  const tabItems = baseTabItems.filter(i => {
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase())
    const matchCat    = !filterCategory || i.category === filterCategory
    return matchSearch && matchCat
  })

  const expiredCount = items.filter(i => getExpiryStatus(i) === 'expired').length
  const warnCount    = items.filter(i => ['soon', 'week'].includes(getExpiryStatus(i))).length
  const lowStockCount = items.filter(i => i.quantity <= i.low_threshold).length

  return (
    <div className="inventory-page">
      <div className="page-header">
        <h1>Inventory</h1>
        <div className="page-header-actions">
          {selectMode ? (
            <button className="btn btn-ghost" onClick={exitSelectMode}>Cancel</button>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => setSelectMode(true)}>Select</button>
              <label className={'btn btn-ghost' + (scanLoading ? ' disabled' : '')}>
                {scanLoading ? <><span className="spinner" /> Scanning…</> : '📷 AI Scan'}
                <input type="file" accept="image/*" capture="environment" onChange={handleScanFile} style={{ display: 'none' }} disabled={scanLoading} />
              </label>
              <button className="btn btn-primary" onClick={openAdd}>+ Add Item</button>
            </>
          )}
        </div>
      </div>

      <p className="scan-hint">AI Scan takes a photo of your fridge or pantry and automatically identifies and adds items.</p>

      {scanError && <div className="error-msg">{scanError}</div>}

      {(expiredCount > 0 || warnCount > 0) && (
        <div className="expiry-banner" onClick={() => setActiveTab('expiring')}>
          {expiredCount > 0 && <span className="expiry-banner-chip chip-expired">🔴 {expiredCount} expired</span>}
          {warnCount   > 0 && <span className="expiry-banner-chip chip-warn">🟠 {warnCount} expiring soon</span>}
          <span className="expiry-banner-cta">View all →</span>
        </div>
      )}

      <div className="stats-row">
        {LOCATIONS.map(loc => (
          <div key={loc} className="stat-card" onClick={() => setActiveTab(loc)} style={{ cursor: 'pointer' }}>
            <div className="stat-label">{loc.charAt(0).toUpperCase() + loc.slice(1)}</div>
            <div className="stat-value" style={{ color: counts[loc] === 0 ? 'var(--text-muted)' : 'inherit' }}>
              {counts[loc] || 0}
            </div>
            <div className="stat-sub">items</div>
          </div>
        ))}
        <div className="stat-card">
          <div className="stat-label">⚠️ Low Stock</div>
          <div className="stat-value" style={{ color: lowStockCount > 0 ? 'var(--warning)' : 'inherit' }}>
            {lowStockCount}
          </div>
          <div className="stat-sub">of {items.length} items</div>
        </div>
      </div>

      <div className="tabs">
        {LOCATIONS.map(loc => (
          <button
            key={loc}
            className={'tab-btn' + (activeTab === loc ? ' active' : '') + (counts[loc] === 0 ? ' tab-zero' : '')}
            onClick={() => setActiveTab(loc)}
          >
            {loc.charAt(0).toUpperCase() + loc.slice(1)} ({counts[loc] || 0})
          </button>
        ))}
        <button
          className={'tab-btn' + (activeTab === 'expiring' ? ' active' : '') + ((expiredCount + warnCount) > 0 ? ' tab-btn-alert' : '')}
          onClick={() => setActiveTab('expiring')}
        >
          ⏰ Expiring ({expiringTabItems.length})
        </button>
      </div>

      {/* Filter row */}
      {baseTabItems.length > 0 && (
        <div className="inventory-filter-row">
          <input
            className="filter-input"
            placeholder="Search items…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="filter-select" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {(search || filterCategory) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterCategory('') }}>
              Clear
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="inventory-onboarding">
          <div className="inventory-onboarding-content">
            <span className="inventory-onboarding-icon">📦</span>
            <h2>Your inventory is empty</h2>
            <p>Start by scanning your fridge or pantry with AI, or add items manually.</p>
            <div className="inventory-onboarding-actions">
              <label className={'btn btn-primary' + (scanLoading ? ' disabled' : '')}>
                {scanLoading ? <><span className="spinner" /> Scanning…</> : '📷 AI Scan Fridge or Pantry'}
                <input type="file" accept="image/*" capture="environment" onChange={handleScanFile} style={{ display: 'none' }} disabled={scanLoading} />
              </label>
              <button className="btn btn-ghost" onClick={openAdd}>+ Add manually</button>
            </div>
          </div>
        </div>
      ) : tabItems.length === 0 ? (
        <div className="inventory-tab-empty">
          {(search || filterCategory) ? (
            <p>No items match your filter. <button className="link-btn" onClick={() => { setSearch(''); setFilterCategory('') }}>Clear filter</button></p>
          ) : activeTab === 'expiring' ? (
            <><span style={{ fontSize: '2rem' }}>✅</span><p>No items with expiry dates tracked.</p></>
          ) : (
            <><span style={{ fontSize: '2rem' }}>📦</span><p>Nothing in {activeTab} yet.</p><button className="btn btn-ghost btn-sm" onClick={openAdd}>+ Add item</button></>
          )}
        </div>
      ) : (
        <>
        {selectMode && tabItems.length > 0 && (
          <div className="select-all-bar">
            <input
              type="checkbox"
              checked={selectedIds.size === tabItems.length && tabItems.length > 0}
              ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < tabItems.length }}
              onChange={toggleSelectAll}
            />
            <span className="select-all-label">
              {selectedIds.size === 0
                ? 'Select all'
                : `${selectedIds.size} of ${tabItems.length} selected`}
            </span>
          </div>
        )}
        <div className="inventory-grid">
          {tabItems.map(item => {
            const expStatus = getExpiryStatus(item)
            const needsExpiry = item.is_fresh_produce && !item.expiry_date
            return (
              <div
                key={item.id}
                className={[
                  'inventory-card card',
                  item.quantity <= item.low_threshold ? 'low-stock' : '',
                  expStatus ? `expiry-${expStatus}` : '',
                  selectMode && selectedIds.has(item.id) ? 'card-selected' : '',
                ].filter(Boolean).join(' ')}
                onClick={selectMode ? () => toggleSelect(item.id) : undefined}
                style={selectMode ? { cursor: 'pointer' } : undefined}
              >
                {selectMode && (
                  <div className="card-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      onClick={e => e.stopPropagation()}
                    />
                  </div>
                )}
                <div className="inventory-card-header">
                  <span className="inventory-name">{item.name}</span>
                  <div className="inventory-badges">
                    {item.quantity <= item.low_threshold && <span className="badge badge-warning">Low</span>}
                    {expStatus === 'expired' && <span className="badge badge-danger">Expired</span>}
                    {expStatus === 'soon'    && <span className="badge badge-warning">Expiring Soon</span>}
                    {expStatus === 'week'    && <span className="badge badge-expiry-week">This Week</span>}
                  </div>
                </div>
                <div className="inventory-meta">
                  <span className="badge badge-neutral">{item.category}</span>
                  {activeTab === 'expiring' && <span className="badge badge-neutral">{item.location}</span>}
                  <span className="inventory-qty">{item.quantity} {item.unit}</span>
                </div>
                {item.expiry_date && (
                  <div className={`inventory-expiry${expStatus ? ` expiry-text-${expStatus}` : ''}`}>
                    Expires: {formatExpiry(item.expiry_date)}
                  </div>
                )}
                {needsExpiry && (
                  <button className="expiry-reminder" onClick={() => openEdit(item)}>+ Add expiry date</button>
                )}
                {item.notes && <div className="inventory-notes">{item.notes}</div>}
                <div className="inventory-actions">
                  <div className="inventory-quick-actions">
                    <button
                      className={`mark-low-btn${addedToList.has(item.id) ? ' mark-low-btn--done' : ''}`}
                      onClick={() => markAsLow(item)}
                      disabled={addedToList.has(item.id)}
                      title={item.quantity <= item.low_threshold ? 'Add to shopping list' : 'Mark as low and add to shopping list'}
                    >
                      {addedToList.has(item.id)
                        ? '✓ On list'
                        : item.quantity <= item.low_threshold
                          ? '+ Add to list'
                          : '⚠ Mark as Low'}
                    </button>

                    {restockItem?.id === item.id ? (
                      <div className="restock-inline">
                        <input
                          type="number"
                          min="0.1"
                          step="0.1"
                          value={restockItem.qty}
                          onChange={e => setRestockItem(r => ({ ...r, qty: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') confirmRestock(item); if (e.key === 'Escape') setRestockItem(null) }}
                          className="restock-qty-input"
                          autoFocus
                        />
                        <span className="restock-unit">{item.unit}</span>
                        <button className="restock-confirm" onClick={() => confirmRestock(item)} title="Confirm">✓</button>
                        <button className="restock-cancel" onClick={() => setRestockItem(null)} title="Cancel">✕</button>
                      </div>
                    ) : (
                      <button
                        className="mark-restock-btn"
                        onClick={() => { setRestockItem({ id: item.id, qty: item.quantity > 0 ? item.quantity : 1 }) }}
                        title="Mark as restocked — enter new quantity"
                      >
                        ↑ Restocked
                      </button>
                    )}
                  </div>

                  <div className="inventory-icon-actions">
                    <button className="btn-icon" onClick={() => openEdit(item)} title="Edit">✏️</button>
                    <button className="btn-icon danger" onClick={() => handleDelete(item.id)} title="Delete">🗑️</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Floating bulk action bar */}
        {selectMode && selectedIds.size > 0 && (
          <div className="bulk-action-bar">
            <span className="bulk-action-count">{selectedIds.size} selected</span>
            <button
              className="btn btn-primary btn-sm"
              onClick={bulkMarkAsLow}
              disabled={bulkWorking}
            >
              {bulkWorking ? <><span className="spinner" /> Working…</> : '⚠ Mark as Low + Add to List'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exitSelectMode}>Cancel</button>
          </div>
        )}
        </>
      )}

      {/* Add / Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editItem ? 'Edit Item' : 'Add Item'}>
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>Name</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Milk" />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Category</label>
            <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Location</label>
            <select value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))}>
              {LOCATIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Quantity</label>
            <input type="number" min="0" step="0.1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Unit</label>
            <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Low Threshold</label>
            <input type="number" min="0" step="0.1" value={form.low_threshold} onChange={e => setForm(f => ({ ...f, low_threshold: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Expiry Date</label>
            <input type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label>
            <input type="checkbox" checked={form.is_fresh_produce} onChange={e => setForm(f => ({ ...f, is_fresh_produce: e.target.checked }))} style={{ width: 'auto', marginRight: '0.5rem' }} />
            Fresh Produce
          </label>
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" rows={2} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            {editItem ? 'Save Changes' : 'Add Item'}
          </button>
        </div>
      </Modal>

      {/* Scan Results Modal */}
      <Modal isOpen={showScanModal} onClose={() => { setShowScanModal(false); setScannedItems(null) }} title="AI Scan Results">
        <p className="scan-intro">Select items to add to your inventory:</p>
        {scannedItems?.map((item, i) => (
          <div key={i} className="scan-item">
            <input type="checkbox" checked={item.selected}
              onChange={e => setScannedItems(prev => prev.map((s, j) => j === i ? { ...s, selected: e.target.checked } : s))} />
            <div className="scan-item-info">
              <span className="scan-item-name">{item.name}</span>
              <span className="scan-item-meta">{item.quantity} {item.unit} · {item.category} · {item.location}</span>
            </div>
          </div>
        ))}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => { setShowScanModal(false); setScannedItems(null) }}>Cancel</button>
          <button className="btn btn-primary" onClick={addScannedItems} disabled={addingScanned || !scannedItems?.some(i => i.selected)}>
            {addingScanned ? <span className="spinner" /> : null}
            Add Selected ({scannedItems?.filter(i => i.selected).length || 0})
          </button>
        </div>
      </Modal>
    </div>
  )
}
