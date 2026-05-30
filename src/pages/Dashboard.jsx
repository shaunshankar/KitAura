import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generateInventoryRecipes } from '../lib/claude'
import Modal from '../components/Modal'
import { format, startOfMonth, endOfMonth, startOfWeek } from 'date-fns'
import './Dashboard.css'

const MEAL_ICONS = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍎' }
const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

function getExpiryStatus(item) {
  if (!item.expiry_date) return null
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const exp = new Date(item.expiry_date); exp.setHours(0, 0, 0, 0)
  const diff = Math.floor((exp - now) / 86400000)
  if (diff <= 0) return 'expired'
  if (diff <= 3) return 'soon'
  return null
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  return 'evening'
}

function firstName(profile, email) {
  const raw = profile?.display_name || profile?.name || ''
  const first = raw.trim().split(/\s+/)[0]
  if (first) return first.charAt(0).toUpperCase() + first.slice(1)
  const fallback = email?.split('@')[0] || 'there'
  return fallback.charAt(0).toUpperCase() + fallback.slice(1)
}

export default function Dashboard({ user }) {
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    () => localStorage.getItem('ka-onboarding-dismissed') === '1'
  )

  function dismissOnboarding() {
    localStorage.setItem('ka-onboarding-dismissed', '1')
    setOnboardingDismissed(true)
  }

  const [inventory, setInventory] = useState([])
  const [shopping, setShopping] = useState([])
  const [todayMeals, setTodayMeals] = useState([])
  const [todayLogs, setTodayLogs] = useState([])
  const [spendRecords, setSpendRecords] = useState([])

  // ── Expiry recipe generation ─────────────────────────────────────
  const [recipesLoading, setRecipesLoading] = useState(false)
  const [recipesError, setRecipesError] = useState('')
  const [recipeSuggestions, setRecipeSuggestions] = useState([])
  const [showRecipesModal, setShowRecipesModal] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState(null)

  useEffect(() => { loadAll() }, [user])

  async function loadAll() {
    setLoading(true)
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('household_id, name, display_name')
      .eq('id', user.id)
      .single()
    setProfile(prof)
    const hhId = prof?.household_id

    const today      = format(new Date(), 'yyyy-MM-dd')
    const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd')
    const monthEnd   = format(endOfMonth(new Date()), 'yyyy-MM-dd')

    const scoped = q => hhId ? q.eq('household_id', hhId) : q.eq('created_by', user.id)

    const [invRes, shopRes, planRes, logRes, spendRes] = await Promise.all([
      scoped(supabase.from('inventory_items').select('id,name,quantity,unit,low_threshold,expiry_date,category')),
      scoped(supabase.from('shopping_list_items').select('id,name,quantity,unit').eq('is_purchased', false).order('created_at')),
      scoped(supabase.from('meal_plans').select('id,meal_type,recipe_name,servings').eq('date', today)),
      supabase.from('meal_logs').select('calories,protein_g,carbs_g,fat_g,servings').eq('created_by', user.id).eq('date', today),
      scoped(supabase.from('grocery_spend').select('id,date,store,total').gte('date', monthStart).lte('date', monthEnd).order('date', { ascending: false })),
    ])

    setInventory(invRes.data || [])
    setShopping(shopRes.data || [])
    setTodayMeals(planRes.data || [])
    setTodayLogs(logRes.data || [])
    setSpendRecords(spendRes.data || [])
    setLoading(false)
  }

  async function handleGetExpiryRecipes() {
    setRecipesLoading(true)
    setRecipesError('')
    setRecipeSuggestions([])
    setExpandedIdx(0)
    setShowRecipesModal(true)
    try {
      const results = await generateInventoryRecipes(inventory)
      setRecipeSuggestions(results)
    } catch (err) {
      setRecipesError(err.message || 'Could not generate recipes. Please try again.')
    } finally {
      setRecipesLoading(false)
    }
  }

  // ── Derived values ───────────────────────────────────────────────
  const expiredItems  = inventory.filter(i => getExpiryStatus(i) === 'expired')
  const soonItems     = inventory.filter(i => getExpiryStatus(i) === 'soon')
  const lowStockCount = inventory.filter(i => i.quantity <= i.low_threshold).length

  const nutrition = todayLogs.reduce(
    (acc, l) => ({
      calories: acc.calories + l.calories * l.servings,
      protein:  acc.protein  + l.protein_g * l.servings,
      carbs:    acc.carbs    + l.carbs_g * l.servings,
      fat:      acc.fat      + l.fat_g * l.servings,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  )

  const weekStart      = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const thisWeekSpend  = spendRecords.filter(r => r.date >= weekStart).reduce((s, r) => s + r.total, 0)
  const thisMonthSpend = spendRecords.reduce((s, r) => s + r.total, 0)

  const mealByType   = Object.fromEntries(MEAL_TYPES.map(t => [t, todayMeals.find(m => m.meal_type === t)]))
  const plannedCount = MEAL_TYPES.filter(t => mealByType[t]).length

  const hasAnyData = inventory.length > 0 || shopping.length > 0 || todayLogs.length > 0 || spendRecords.length > 0
  const hasExpiring = expiredItems.length > 0 || soonItems.length > 0

  if (loading) {
    return (
      <div className="dashboard-loader">
        <span className="spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
        <p>Loading dashboard…</p>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <div className="page-header">
        <div>
          <h1>Good {greeting()}, {firstName(profile, user.email)}!</h1>
          <p className="dashboard-date">{format(new Date(), 'EEEE, MMMM d')}</p>
        </div>
      </div>

      {/* ── Expiry Alerts ────────────────────────────────────────── */}
      {inventory.length > 0 && !hasExpiring && (
        <div className="expiry-alert alert-ok">
          <span className="alert-icon">✓</span>
          <span>All good! Nothing expired or expiring soon.</span>
        </div>
      )}

      {hasExpiring && (
        <div className="expiry-alerts-stack">
          {expiredItems.length > 0 && (
            <div className="expiry-alert alert-danger">
              <span className="alert-icon">🔴</span>
              <div className="alert-body">
                <strong>{expiredItems.length} item{expiredItems.length !== 1 ? 's' : ''} expired</strong>
                <span className="alert-names">{expiredItems.map(i => i.name).join(' · ')}</span>
              </div>
              <div className="alert-actions">
                <button
                  className="btn btn-sm alert-recipe-btn"
                  onClick={handleGetExpiryRecipes}
                  disabled={recipesLoading}
                >
                  {recipesLoading ? <><span className="spinner" /> Finding…</> : '✨ Get Recipes'}
                </button>
                <Link to="/inventory" className="alert-cta">View →</Link>
              </div>
            </div>
          )}
          {soonItems.length > 0 && (
            <div className="expiry-alert alert-warn">
              <span className="alert-icon">🟠</span>
              <div className="alert-body">
                <strong>{soonItems.length} item{soonItems.length !== 1 ? 's' : ''} expiring within 3 days</strong>
                <span className="alert-names">{soonItems.map(i => i.name).join(' · ')}</span>
              </div>
              <div className="alert-actions">
                <button
                  className="btn btn-sm alert-recipe-btn"
                  onClick={handleGetExpiryRecipes}
                  disabled={recipesLoading}
                >
                  {recipesLoading ? <><span className="spinner" /> Finding…</> : '✨ Get Recipes'}
                </button>
                <Link to="/inventory" className="alert-cta">View →</Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Onboarding OR Stats ──────────────────────────────────── */}
      {!hasAnyData && !onboardingDismissed ? (
        <div className="onboarding-card card">
          <div className="onboarding-header">
            <div>
              <h2 className="onboarding-title">Welcome to KitAura! Let's get you set up.</h2>
              <p className="onboarding-sub">Complete these steps to get the most out of your kitchen dashboard.</p>
            </div>
            <button className="onboarding-dismiss" onClick={dismissOnboarding} title="Dismiss">✕</button>
          </div>
          <div className="onboarding-steps">
            <Link to="/inventory" className="onboarding-step">
              <span className="onboarding-step-num">1</span>
              <div><strong>Add your first inventory item</strong><p>Scan your fridge or pantry with AI, or add items manually.</p></div>
              <span className="onboarding-arrow">→</span>
            </Link>
            <Link to="/household" className="onboarding-step">
              <span className="onboarding-step-num">2</span>
              <div><strong>Set up your household</strong><p>Share your kitchen with family or housemates.</p></div>
              <span className="onboarding-arrow">→</span>
            </Link>
            <Link to="/meal-log" className="onboarding-step">
              <span className="onboarding-step-num">3</span>
              <div><strong>Log your first meal</strong><p>Track nutrition with AI photo scanning or manual entry.</p></div>
              <span className="onboarding-arrow">→</span>
            </Link>
            <Link to="/grocery-spend" className="onboarding-step">
              <span className="onboarding-step-num">4</span>
              <div><strong>Record a grocery trip</strong><p>Scan a receipt or add spending manually to track your budget.</p></div>
              <span className="onboarding-arrow">→</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="stats-row">
          <Link to="/inventory" className="stat-card stat-card-link">
            <div className="stat-label">📦 Inventory</div>
            <div className="stat-value">{inventory.length}</div>
            <div className="stat-sub">items tracked</div>
          </Link>
          <Link to="/inventory" className="stat-card stat-card-link">
            <div className="stat-label">⚠️ Low Stock</div>
            <div className="stat-value" style={{ color: lowStockCount > 0 ? 'var(--warning)' : 'inherit' }}>{lowStockCount}</div>
            <div className="stat-sub">of {inventory.length} items</div>
          </Link>
          <Link to="/shopping" className="stat-card stat-card-link">
            <div className="stat-label">🛒 Shopping</div>
            <div className="stat-value" style={{ color: shopping.length > 0 ? 'var(--accent-light)' : 'inherit' }}>{shopping.length}</div>
            <div className="stat-sub">items remaining</div>
          </Link>
          <Link to="/grocery-spend" className="stat-card stat-card-link">
            <div className="stat-label">💰 This Month</div>
            <div className="stat-value">${thisMonthSpend.toFixed(0)}</div>
            <div className="stat-sub">grocery spend</div>
          </Link>
        </div>
      )}

      {/* ── Main 2×2 grid ───────────────────────────────────────── */}
      <div className="dashboard-grid">

        {/* Today's Meals — top-left */}
        <div className="dash-card card">
          <div className="dash-card-header">
            <h3 className="dash-card-title">Today's Meals</h3>
            <Link to="/meal-planner" className="dash-card-link">Open planner →</Link>
          </div>
          {plannedCount === 0 ? (
            <div className="dash-empty">
              <p>Nothing planned today.</p>
              <p className="dash-empty-tip">Plan your meals for the week and KitAura will track your nutrition automatically.</p>
              <Link to="/meal-planner" className="btn btn-ghost btn-sm dash-empty-action">Open meal planner →</Link>
            </div>
          ) : (
            <div className="meals-list">
              {MEAL_TYPES.map(type => {
                const meal = mealByType[type]
                if (!meal) return null
                return (
                  <div key={type} className="meal-row">
                    <span className="meal-row-icon">{MEAL_ICONS[type]}</span>
                    <div className="meal-row-info">
                      <span className="meal-row-type">{type}</span>
                      <span className="meal-row-name">{meal.recipe_name}</span>
                    </div>
                    {meal.servings > 1 && <span className="meal-row-servings">×{meal.servings}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Nutrition Today — top-right */}
        <div className="dash-card card">
          <div className="dash-card-header">
            <h3 className="dash-card-title">Nutrition Today</h3>
            <Link to="/meal-log" className="dash-card-link">Log meals →</Link>
          </div>
          {todayLogs.length === 0 ? (
            <div className="dash-empty">
              <p>No meals logged today.</p>
              <p className="dash-empty-tip">Use AI photo scanning to log meals instantly — just take a photo of your food.</p>
              <Link to="/meal-log" className="btn btn-ghost btn-sm dash-empty-action">Log a meal →</Link>
            </div>
          ) : (
            <div className="nutrition-grid">
              <div className="nutrition-primary">
                <span className="nutrition-big">{Math.round(nutrition.calories)}</span>
                <span className="nutrition-big-label">kcal</span>
              </div>
              <div className="nutrition-macros">
                <div className="macro-item"><span className="macro-value">{Math.round(nutrition.protein)}g</span><span className="macro-label">Protein</span></div>
                <div className="macro-item"><span className="macro-value">{Math.round(nutrition.carbs)}g</span><span className="macro-label">Carbs</span></div>
                <div className="macro-item"><span className="macro-value">{Math.round(nutrition.fat)}g</span><span className="macro-label">Fat</span></div>
              </div>
            </div>
          )}
        </div>

        {/* Shopping Snapshot — bottom-left */}
        <div className="dash-card card">
          <div className="dash-card-header">
            <h3 className="dash-card-title">Shopping List</h3>
            <Link to="/shopping" className="dash-card-link">View all →</Link>
          </div>
          {shopping.length === 0 ? (
            <div className="dash-empty">
              <p>Shopping list is empty.</p>
              <p className="dash-empty-tip">Add low-stock items from your inventory or items you need for upcoming meals.</p>
            </div>
          ) : (
            <>
              <ul className="snap-list">
                {shopping.slice(0, 5).map(item => (
                  <li key={item.id} className="snap-item">
                    <span className="snap-bullet" />
                    <span className="snap-name">{item.name}</span>
                    <span className="snap-qty">{item.quantity} {item.unit}</span>
                  </li>
                ))}
              </ul>
              {shopping.length > 5 && (
                <Link to="/shopping" className="snap-more">+{shopping.length - 5} more items</Link>
              )}
            </>
          )}
        </div>

        {/* Recent Grocery Spend — bottom-right */}
        <div className="dash-card card">
          <div className="dash-card-header">
            <h3 className="dash-card-title">Grocery Spend</h3>
            <Link to="/grocery-spend" className="dash-card-link">View all →</Link>
          </div>
          <div className="spend-summary-row">
            <div className="spend-summary-cell">
              <span className="spend-summary-label">This week</span>
              <span className="spend-summary-amount">${thisWeekSpend.toFixed(2)}</span>
            </div>
            <div className="spend-summary-divider" />
            <div className="spend-summary-cell">
              <span className="spend-summary-label">This month</span>
              <span className="spend-summary-amount">${thisMonthSpend.toFixed(2)}</span>
            </div>
          </div>
          {spendRecords.length === 0 ? (
            <div className="dash-empty" style={{ paddingTop: '0.75rem' }}>
              <p>No trips recorded this month.</p>
            </div>
          ) : (
            <ul className="spend-trips">
              {spendRecords.slice(0, 3).map(r => (
                <li key={r.id} className="spend-trip">
                  <div className="spend-trip-left">
                    <span className="spend-trip-store">{r.store || 'Store'}</span>
                    <span className="spend-trip-date">{format(new Date(r.date + 'T00:00:00'), 'MMM d')}</span>
                  </div>
                  <span className="spend-trip-total">${r.total.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>

      {/* ── Expiry Recipes Modal ─────────────────────────────────── */}
      <Modal
        isOpen={showRecipesModal}
        onClose={() => { setShowRecipesModal(false); setRecipeSuggestions([]); setRecipesError('') }}
        title="Recipes using expiring ingredients"
      >
        {recipesLoading && (
          <div className="er-loading">
            <span className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
            <p>Claude is finding the best recipes for your expiring items…</p>
          </div>
        )}

        {recipesError && (
          <div className="error-msg">{recipesError}</div>
        )}

        {!recipesLoading && recipeSuggestions.length > 0 && (
          <div className="er-list">
            {recipeSuggestions.map((rec, idx) => {
              const isOpen = expandedIdx === idx
              return (
                <div key={idx} className={`er-card${isOpen ? ' er-card--open' : ''}`}>
                  {/* Header — always visible, click to expand */}
                  <button className="er-card-header" onClick={() => setExpandedIdx(isOpen ? null : idx)}>
                    <div className="er-card-top">
                      <span className="er-card-name">{rec.name}</span>
                      <span className={`er-diff er-diff--${rec.difficulty.toLowerCase()}`}>{rec.difficulty}</span>
                    </div>
                    <div className="er-card-meta">
                      <span>⏱ {rec.cook_time_mins} min</span>
                      {rec.uses_expiring?.length > 0 && (
                        <span className="er-uses">
                          Uses:&nbsp;{rec.uses_expiring.map(n => (
                            <span key={n} className="er-expiring-pill">{n}</span>
                          ))}
                        </span>
                      )}
                    </div>
                    <span className="er-chevron">{isOpen ? '▲' : '▼'}</span>
                  </button>

                  {/* Body — only when expanded */}
                  {isOpen && (
                    <div className="er-card-body">
                      <h4 className="er-section-label">Ingredients</h4>
                      <ul className="er-ingredients">
                        {rec.ingredients.map((ing, i) => (
                          <li key={i} className={`er-ing er-ing--${!ing.in_inventory ? 'missing' : ing.expiring ? 'expiring' : 'have'}`}>
                            <span className="er-ing-icon">
                              {!ing.in_inventory ? '✗' : ing.expiring ? '⚠' : '✓'}
                            </span>
                            <span className="er-ing-text">
                              <strong>{ing.quantity} {ing.unit}</strong> {ing.name}
                            </span>
                            {ing.expiring && <span className="er-tag er-tag--expiring">expiring</span>}
                            {!ing.in_inventory && <span className="er-tag er-tag--missing">need to buy</span>}
                          </li>
                        ))}
                      </ul>

                      <h4 className="er-section-label">Instructions</h4>
                      <ol className="er-steps">
                        {rec.steps.map((step, i) => <li key={i}>{step}</li>)}
                      </ol>

                      <div className="er-card-footer">
                        <Link to="/recipes" className="btn btn-ghost btn-sm" onClick={() => setShowRecipesModal(false)}>
                          Open full Recipes page →
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Modal>
    </div>
  )
}
