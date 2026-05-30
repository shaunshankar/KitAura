import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import Modal from '../components/Modal'
import { format, startOfWeek, addDays, addWeeks, subWeeks, parseISO } from 'date-fns'
import './MealPlanner.css'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']
const MEAL_ICONS = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍎' }

export default function MealPlanner({ user }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [meals, setMeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [selectedCell, setSelectedCell] = useState(null)
  const [editMeal, setEditMeal] = useState(null)
  const [form, setForm] = useState({ recipe_name: '', notes: '', servings: 1 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [profile, setProfile] = useState(null)

  useEffect(() => { loadProfile() }, [user])
  useEffect(() => { if (profile !== undefined) loadMeals() }, [profile, weekStart])

  async function loadProfile() {
    const { data } = await supabase.from('user_profiles').select('household_id').eq('id', user.id).single()
    setProfile(data)
  }

  async function loadMeals() {
    setLoading(true)
    const weekEnd = addDays(weekStart, 6)
    const from = format(weekStart, 'yyyy-MM-dd')
    const to = format(weekEnd, 'yyyy-MM-dd')

    let query = supabase.from('meal_plans').select('*').gte('date', from).lte('date', to)
    if (profile?.household_id) {
      query = query.eq('household_id', profile.household_id)
    } else {
      query = query.eq('created_by', user.id)
    }
    const { data } = await query
    setMeals(data || [])
    setLoading(false)
  }

  function getMeal(date, mealType) {
    const dateStr = format(date, 'yyyy-MM-dd')
    return meals.find(m => m.date === dateStr && m.meal_type === mealType)
  }

  function openCell(date, mealType) {
    const existing = getMeal(date, mealType)
    setSelectedCell({ date, mealType })
    if (existing) {
      setEditMeal(existing)
      setForm({ recipe_name: existing.recipe_name, notes: existing.notes || '', servings: existing.servings })
    } else {
      setEditMeal(null)
      setForm({ recipe_name: '', notes: '', servings: 1 })
    }
    setError('')
    setShowModal(true)
  }

  async function handleSave() {
    if (!form.recipe_name.trim()) { setError('Recipe name is required'); return }
    setSaving(true)
    setError('')
    const dateStr = format(selectedCell.date, 'yyyy-MM-dd')
    const payload = {
      date: dateStr,
      meal_type: selectedCell.mealType,
      recipe_name: form.recipe_name.trim(),
      notes: form.notes || null,
      servings: Number(form.servings),
      created_by: user.id,
      household_id: profile?.household_id || null,
    }
    let err
    if (editMeal) {
      ;({ error: err } = await supabase.from('meal_plans').update(payload).eq('id', editMeal.id))
    } else {
      ;({ error: err } = await supabase.from('meal_plans').insert(payload))
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowModal(false)
    loadMeals()
  }

  async function handleDelete() {
    if (!editMeal) return
    if (!confirm('Remove this meal?')) return
    await supabase.from('meal_plans').delete().eq('id', editMeal.id)
    setShowModal(false)
    loadMeals()
  }

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="planner-page">
      <div className="page-header">
        <h1>Meal Planner</h1>
        <div className="page-header-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(w => subWeeks(w, 1))}>← Prev</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setWeekStart(w => addWeeks(w, 1))}>Next →</button>
        </div>
      </div>

      <div className="planner-week-label">
        {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
      </div>

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Loading…</div>
      ) : (
        <div className="planner-grid-wrapper">
          <div className="planner-grid">
            {/* Header row */}
            <div className="planner-header-cell planner-corner" />
            {weekDays.map(day => (
              <div key={day.toISOString()} className={'planner-header-cell' + (format(day, 'yyyy-MM-dd') === today ? ' today' : '')}>
                <span className="planner-day-name">{format(day, 'EEE')}</span>
                <span className="planner-day-num">{format(day, 'd')}</span>
              </div>
            ))}

            {/* Meal type rows */}
            {MEAL_TYPES.map(mealType => (
              <>
                <div key={mealType + '-label'} className="planner-row-label">
                  <span>{MEAL_ICONS[mealType]}</span>
                  <span>{mealType}</span>
                </div>
                {weekDays.map(day => {
                  const meal = getMeal(day, mealType)
                  const isToday = format(day, 'yyyy-MM-dd') === today
                  return (
                    <div
                      key={day.toISOString() + mealType}
                      className={'planner-cell' + (meal ? ' has-meal' : ' empty') + (isToday ? ' today' : '')}
                      onClick={() => openCell(day, mealType)}
                    >
                      {meal ? (
                        <span className="planner-meal-name">{meal.recipe_name}</span>
                      ) : (
                        <span className="planner-add-hint">+</span>
                      )}
                    </div>
                  )
                })}
              </>
            ))}
          </div>
        </div>
      )}

      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={selectedCell ? `${MEAL_ICONS[selectedCell?.mealType]} ${selectedCell?.mealType?.charAt(0).toUpperCase() + selectedCell?.mealType?.slice(1)} — ${selectedCell ? format(selectedCell.date, 'EEE, MMM d') : ''}` : ''}
      >
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>Recipe / Meal Name</label>
          <input
            value={form.recipe_name}
            onChange={e => setForm(f => ({ ...f, recipe_name: e.target.value }))}
            placeholder="e.g. Avocado Toast"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>Servings</label>
          <input type="number" min="0.5" step="0.5" value={form.servings} onChange={e => setForm(f => ({ ...f, servings: e.target.value }))} />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" rows={2} />
        </div>
        <div className="modal-footer">
          {editMeal && (
            <button className="btn btn-danger btn-sm" onClick={handleDelete}>Remove</button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            {editMeal ? 'Save Changes' : 'Add Meal'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
