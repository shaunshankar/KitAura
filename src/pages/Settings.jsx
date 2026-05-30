import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import './Settings.css'

const DIETARY_OPTIONS = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'gluten-free', label: 'Gluten-free' },
  { value: 'dairy-free', label: 'Dairy-free' },
  { value: 'nut-free', label: 'Nut-free' },
  { value: 'halal', label: 'Halal' },
  { value: 'kosher', label: 'Kosher' },
]

const DEFAULT_GOALS = { calories: 2000, protein: 150, carbs: 250, fat: 65 }

export default function Settings({ user }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  const [displayName, setDisplayName] = useState('')
  const [goals, setGoals] = useState(DEFAULT_GOALS)
  const [dietaryPrefs, setDietaryPrefs] = useState([])

  useEffect(() => { loadProfile() }, [user])

  async function loadProfile() {
    setLoading(true)
    const { data } = await supabase
      .from('user_profiles')
      .select('name, display_name, calorie_goal, protein_goal, carbs_goal, fat_goal, dietary_prefs')
      .eq('id', user.id)
      .single()

    if (data) {
      setDisplayName(data.display_name || data.name || '')
      setGoals({
        calories: data.calorie_goal ?? DEFAULT_GOALS.calories,
        protein:  data.protein_goal  ?? DEFAULT_GOALS.protein,
        carbs:    data.carbs_goal    ?? DEFAULT_GOALS.carbs,
        fat:      data.fat_goal      ?? DEFAULT_GOALS.fat,
      })
      setDietaryPrefs(data.dietary_prefs || [])
    }
    setLoading(false)
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess(false)

    const { error: err } = await supabase
      .from('user_profiles')
      .update({
        display_name:  displayName.trim() || null,
        calorie_goal:  Number(goals.calories),
        protein_goal:  Number(goals.protein),
        carbs_goal:    Number(goals.carbs),
        fat_goal:      Number(goals.fat),
        dietary_prefs: dietaryPrefs,
        updated_at:    new Date().toISOString(),
      })
      .eq('id', user.id)

    setSaving(false)

    if (err) {
      setError(
        err.message.includes('column')
          ? 'Run the settings migration in your Supabase SQL editor (see schema.sql) before saving goals and preferences.'
          : err.message
      )
      return
    }
    setSuccess(true)
    setTimeout(() => setSuccess(false), 3000)
  }

  function toggleDiet(value) {
    setDietaryPrefs(prev =>
      prev.includes(value) ? prev.filter(p => p !== value) : [...prev, value]
    )
  }

  if (loading) {
    return <div className="loading-state"><span className="spinner" /> Loading…</div>
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {error   && <div className="error-msg">{error}</div>}
      {success && <div className="success-msg">Settings saved!</div>}

      <div className="settings-layout">

        {/* Profile */}
        <section className="settings-section card">
          <h2 className="settings-section-title">Profile</h2>
          <div className="form-group">
            <label>Display Name</label>
            <input
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder={user.email?.split('@')[0] || 'Your name'}
            />
            <span className="form-hint">Used in your dashboard greeting.</span>
          </div>
          <div className="form-group">
            <label>Email</label>
            <input value={user.email || ''} disabled />
          </div>
        </section>

        {/* Nutrition Goals */}
        <section className="settings-section card">
          <h2 className="settings-section-title">Daily Nutrition Goals</h2>
          <p className="settings-section-desc">Progress bars in Meal Log track against these targets.</p>
          <div className="goals-grid">
            <div className="form-group">
              <label>Calories (kcal)</label>
              <input type="number" min="500" max="10000" value={goals.calories}
                onChange={e => setGoals(g => ({ ...g, calories: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Protein (g)</label>
              <input type="number" min="0" max="500" value={goals.protein}
                onChange={e => setGoals(g => ({ ...g, protein: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Carbs (g)</label>
              <input type="number" min="0" max="1000" value={goals.carbs}
                onChange={e => setGoals(g => ({ ...g, carbs: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Fat (g)</label>
              <input type="number" min="0" max="300" value={goals.fat}
                onChange={e => setGoals(g => ({ ...g, fat: e.target.value }))} />
            </div>
          </div>
        </section>

        {/* Dietary Preferences */}
        <section className="settings-section card">
          <h2 className="settings-section-title">Dietary Preferences</h2>
          <p className="settings-section-desc">Claude uses these when generating recipe suggestions for you.</p>
          <div className="dietary-grid">
            {DIETARY_OPTIONS.map(opt => (
              <label
                key={opt.value}
                className={'dietary-option' + (dietaryPrefs.includes(opt.value) ? ' selected' : '')}
              >
                <input
                  type="checkbox"
                  checked={dietaryPrefs.includes(opt.value)}
                  onChange={() => toggleDiet(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </section>

      </div>

      <div className="settings-save-row">
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? <span className="spinner" /> : null}
          Save Settings
        </button>
      </div>
    </div>
  )
}
