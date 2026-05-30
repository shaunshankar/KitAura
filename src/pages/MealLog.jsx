import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { scanMeal, fileToBase64 } from '../lib/claude'
import Modal from '../components/Modal'
import { format, addDays, subDays, parseISO } from 'date-fns'
import './MealLog.css'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']
const MEAL_ICONS = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍎' }
const DEFAULT_GOALS = { calories: 2000, protein: 150, carbs: 250, fat: 65 }

const blankForm = { food_name: '', meal_type: 'breakfast', calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, servings: 1, notes: '' }

function pct(value, goal) { return Math.min(100, Math.round((value / goal) * 100)) }

export default function MealLog({ user }) {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editLog, setEditLog] = useState(null)
  const [form, setForm] = useState(blankForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [scanLoading, setScanLoading] = useState(false)
  const [scanError, setScanError] = useState('')

  useEffect(() => { loadProfile() }, [user])
  useEffect(() => { loadLogs() }, [date])

  async function loadProfile() {
    const { data } = await supabase
      .from('user_profiles')
      .select('calorie_goal, protein_goal, carbs_goal, fat_goal')
      .eq('id', user.id)
      .single()
    setProfile(data)
  }

  const loadLogs = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('meal_logs').select('*').eq('created_by', user.id).eq('date', date).order('created_at')
    setLogs(data || [])
    setLoading(false)
  }, [user.id, date])

  function openAdd(mealType = 'breakfast') {
    setEditLog(null)
    setForm({ ...blankForm, meal_type: mealType })
    setError('')
    setShowModal(true)
  }

  function openEdit(log) {
    setEditLog(log)
    setForm({ food_name: log.food_name, meal_type: log.meal_type, calories: log.calories,
      protein_g: log.protein_g, carbs_g: log.carbs_g, fat_g: log.fat_g, servings: log.servings, notes: log.notes || '' })
    setError('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.food_name.trim()) { setError('Food name is required'); return }
    setSaving(true)
    setError('')
    const payload = { ...form, date, calories: Number(form.calories), protein_g: Number(form.protein_g),
      carbs_g: Number(form.carbs_g), fat_g: Number(form.fat_g), servings: Number(form.servings), created_by: user.id }
    let err
    if (editLog) {
      ;({ error: err } = await supabase.from('meal_logs').update(payload).eq('id', editLog.id))
    } else {
      ;({ error: err } = await supabase.from('meal_logs').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowModal(false)
    loadLogs()
  }

  async function handleDelete(id) {
    if (!confirm('Delete this entry?')) return
    await supabase.from('meal_logs').delete().eq('id', id)
    loadLogs()
  }

  async function handleScanFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setScanError('')
    setScanLoading(true)
    try {
      const base64 = await fileToBase64(file)
      const result = await scanMeal(base64, file.type)
      setEditLog(null)
      setForm({ food_name: result.food_name || '', meal_type: 'breakfast',
        calories: result.calories || 0, protein_g: result.protein_g || 0,
        carbs_g: result.carbs_g || 0, fat_g: result.fat_g || 0,
        servings: result.servings || 1, notes: '' })
      setError('')
      setShowModal(true)
    } catch (err) {
      setScanError(err.message)
    } finally {
      setScanLoading(false)
    }
  }

  const goals = {
    calories: profile?.calorie_goal ?? DEFAULT_GOALS.calories,
    protein:  profile?.protein_goal ?? DEFAULT_GOALS.protein,
    carbs:    profile?.carbs_goal   ?? DEFAULT_GOALS.carbs,
    fat:      profile?.fat_goal     ?? DEFAULT_GOALS.fat,
  }

  const totals = logs.reduce((acc, l) => ({
    calories:  acc.calories  + l.calories  * l.servings,
    protein_g: acc.protein_g + l.protein_g * l.servings,
    carbs_g:   acc.carbs_g   + l.carbs_g   * l.servings,
    fat_g:     acc.fat_g     + l.fat_g     * l.servings,
  }), { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 })

  const grouped = {}
  MEAL_TYPES.forEach(t => { grouped[t] = [] })
  logs.forEach(l => { if (grouped[l.meal_type]) grouped[l.meal_type].push(l) })

  const isToday = date === format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="meal-log-page">
      <div className="page-header">
        <h1>Meal Log</h1>
        <div className="page-header-actions">
          <label className={'btn btn-ghost' + (scanLoading ? ' disabled' : '')}>
            {scanLoading ? <><span className="spinner" /> Scanning…</> : '📷 AI Scan'}
            <input type="file" accept="image/*" capture="environment" onChange={handleScanFile} style={{ display: 'none' }} disabled={scanLoading} />
          </label>
          <button className="btn btn-primary" onClick={() => openAdd()}>+ Add Entry</button>
        </div>
      </div>

      <p className="scan-hint">AI Scan takes a photo of your meal and estimates the calories and macros automatically.</p>

      {scanError && <div className="error-msg">{scanError}</div>}

      <div className="date-nav">
        <button className="btn btn-ghost btn-sm" onClick={() => setDate(d => format(subDays(parseISO(d), 1), 'yyyy-MM-dd'))}>← Prev</button>
        <div className="date-nav-label">
          <span className="date-nav-day">{format(parseISO(date), 'EEEE')}</span>
          <span className="date-nav-date">{format(parseISO(date), 'MMMM d, yyyy')}</span>
          {isToday && <span className="badge badge-accent">Today</span>}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setDate(d => format(addDays(parseISO(d), 1), 'yyyy-MM-dd'))}>Next →</button>
      </div>

      {/* Macro stat cards with progress bars */}
      <div className="stats-row macro-stats-row">
        {[
          { label: 'Calories', value: Math.round(totals.calories),  goal: goals.calories, unit: 'kcal', color: 'var(--accent-light)' },
          { label: 'Protein',  value: Math.round(totals.protein_g), goal: goals.protein,  unit: 'g',    color: '#60a5fa' },
          { label: 'Carbs',    value: Math.round(totals.carbs_g),   goal: goals.carbs,    unit: 'g',    color: '#fb923c' },
          { label: 'Fat',      value: Math.round(totals.fat_g),     goal: goals.fat,      unit: 'g',    color: '#facc15' },
          { label: 'Goal',     value: pct(totals.calories, goals.calories), goal: 100, unit: '%', color: 'var(--success)', isGoal: true },
        ].map(({ label, value, goal, unit, color, isGoal }) => (
          <div key={label} className="stat-card macro-stat-card">
            <div className="stat-label">{label}</div>
            <div className="stat-value">
              {value}{!isGoal && <span style={{ fontSize: '0.9rem', fontWeight: 400 }}>{unit}</span>}
              {isGoal && <span style={{ fontSize: '1rem', fontWeight: 400 }}>%</span>}
            </div>
            <div className="stat-sub">/ {goal}{unit}</div>
            <div className="macro-progress-track">
              <div className="macro-progress-fill" style={{ width: `${pct(value, goal)}%`, background: color }} />
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Loading…</div>
      ) : (
        <div className="meal-groups">
          {MEAL_TYPES.map(mealType => (
            <div key={mealType} className="meal-group">
              <div className="meal-group-header">
                <span>{MEAL_ICONS[mealType]} {mealType.charAt(0).toUpperCase() + mealType.slice(1)}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => openAdd(mealType)}>+ Add</button>
              </div>
              {grouped[mealType].length === 0 ? (
                <div className="meal-group-empty">
                  <button className="meal-group-add-prompt" onClick={() => openAdd(mealType)}>
                    + Log {mealType}…
                  </button>
                </div>
              ) : (
                grouped[mealType].map(log => (
                  <div key={log.id} className="meal-log-item">
                    <div className="meal-log-info">
                      <span className="meal-log-name">{log.food_name}</span>
                      {log.servings !== 1 && <span className="meal-log-servings">× {log.servings}</span>}
                      <div className="meal-log-macros">
                        <span>{Math.round(log.calories * log.servings)} kcal</span>
                        <span>P: {Math.round(log.protein_g * log.servings)}g</span>
                        <span>C: {Math.round(log.carbs_g * log.servings)}g</span>
                        <span>F: {Math.round(log.fat_g * log.servings)}g</span>
                      </div>
                      {log.notes && <div className="meal-log-notes">{log.notes}</div>}
                    </div>
                    <div className="meal-log-actions">
                      <button className="btn-icon" onClick={() => openEdit(log)}>✏️</button>
                      <button className="btn-icon danger" onClick={() => handleDelete(log.id)}>🗑️</button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editLog ? 'Edit Entry' : 'Add Meal Entry'}>
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>Food Name</label>
          <input value={form.food_name} onChange={e => setForm(f => ({ ...f, food_name: e.target.value }))} placeholder="e.g. Oatmeal with berries" autoFocus />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Meal Type</label>
            <select value={form.meal_type} onChange={e => setForm(f => ({ ...f, meal_type: e.target.value }))}>
              {MEAL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label>Servings</label>
            <input type="number" min="0.5" step="0.5" value={form.servings} onChange={e => setForm(f => ({ ...f, servings: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Calories</label>
            <input type="number" min="0" value={form.calories} onChange={e => setForm(f => ({ ...f, calories: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Protein (g)</label>
            <input type="number" min="0" step="0.1" value={form.protein_g} onChange={e => setForm(f => ({ ...f, protein_g: e.target.value }))} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Carbs (g)</label>
            <input type="number" min="0" step="0.1" value={form.carbs_g} onChange={e => setForm(f => ({ ...f, carbs_g: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Fat (g)</label>
            <input type="number" min="0" step="0.1" value={form.fat_g} onChange={e => setForm(f => ({ ...f, fat_g: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label>Notes</label>
          <input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional…" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            {editLog ? 'Save Changes' : 'Add Entry'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
