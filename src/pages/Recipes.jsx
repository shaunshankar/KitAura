import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { generateRecipe, generateInventoryRecipes } from '../lib/claude'
import Modal from '../components/Modal'
import './Recipes.css'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']

export default function Recipes({ user }) {
  const [profile, setProfile] = useState(null)
  const [inventory, setInventory] = useState([])
  const [savedRecipes, setSavedRecipes] = useState([])
  const [loading, setLoading] = useState(true)

  // ── Generate from inventory ──────────────────────────────────────
  const [suggestions, setSuggestions] = useState([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState('')
  const [expandedIdx, setExpandedIdx] = useState(null)
  const [addingMissing, setAddingMissing] = useState(null) // index
  const [justAdded, setJustAdded] = useState(null)         // index

  // ── Planner modal ────────────────────────────────────────────────
  const [plannerModal, setPlannerModal] = useState(null)   // { recipe }
  const [plannerDate, setPlannerDate] = useState(new Date().toISOString().split('T')[0])
  const [plannerMealType, setPlannerMealType] = useState('dinner')
  const [savingPlan, setSavingPlan] = useState(false)
  const [plannerSuccess, setPlannerSuccess] = useState(false)

  // ── Search / URL (existing) ──────────────────────────────────────
  const [mode, setMode] = useState('search')
  const [input, setInput] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [recipe, setRecipe] = useState(null)
  const [showRecipeModal, setShowRecipeModal] = useState(false)
  const [savingRecipe, setSavingRecipe] = useState(false)

  useEffect(() => { loadAll() }, [user])

  async function loadAll() {
    setLoading(true)
    const { data: prof } = await supabase
      .from('user_profiles').select('household_id').eq('id', user.id).single()
    setProfile(prof)

    const invQuery = supabase.from('inventory_items').select('*')
    if (prof?.household_id) invQuery.eq('household_id', prof.household_id)
    else invQuery.eq('created_by', user.id)
    const { data: inv } = await invQuery
    setInventory(inv || [])

    const recQuery = supabase.from('recipes').select('*').order('created_at', { ascending: false })
    if (prof?.household_id) recQuery.eq('household_id', prof.household_id)
    else recQuery.eq('created_by', user.id)
    const { data: recs } = await recQuery
    setSavedRecipes(recs || [])

    setLoading(false)
  }

  // ── Generate from inventory ──────────────────────────────────────
  async function handleGenerateSuggestions() {
    if (!inventory.length) {
      setSuggestionsError('Add some items to your inventory first.')
      return
    }
    setSuggestionsLoading(true)
    setSuggestionsError('')
    setSuggestions([])
    setExpandedIdx(null)
    try {
      const results = await generateInventoryRecipes(inventory)
      setSuggestions(results)
      setExpandedIdx(0)
    } catch (err) {
      setSuggestionsError(err.message || 'Could not generate recipes')
    } finally {
      setSuggestionsLoading(false)
    }
  }

  async function addMissingIngredients(rec, idx) {
    const missing = rec.ingredients.filter(i => !i.in_inventory)
    if (!missing.length) return
    setAddingMissing(idx)
    await supabase.from('shopping_list_items').insert(
      missing.map(i => ({
        name: i.name, quantity: i.quantity, unit: i.unit,
        created_by: user.id, household_id: profile?.household_id || null,
      }))
    )
    setAddingMissing(null)
    setJustAdded(idx)
    setTimeout(() => setJustAdded(null), 2500)
  }

  function openPlannerFor(rec) {
    setPlannerDate(new Date().toISOString().split('T')[0])
    setPlannerMealType('dinner')
    setPlannerSuccess(false)
    setPlannerModal({ recipe: rec })
  }

  async function saveToPlannerConfirm() {
    if (!plannerDate || !plannerModal) return
    setSavingPlan(true)
    await supabase.from('meal_plans').insert({
      date: plannerDate,
      meal_type: plannerMealType,
      recipe_name: plannerModal.recipe.name,
      created_by: user.id,
      household_id: profile?.household_id || null,
    })
    setSavingPlan(false)
    setPlannerSuccess(true)
    setTimeout(() => setPlannerModal(null), 1200)
  }

  // ── Search / URL (existing) ──────────────────────────────────────
  async function handleSearch() {
    if (!input.trim()) return
    setSearching(true)
    setSearchError('')
    setRecipe(null)
    try {
      const result = await generateRecipe({
        query: mode === 'search' ? input.trim() : undefined,
        url: mode === 'url' ? input.trim() : undefined,
        inventory,
      })
      setRecipe(result)
      setShowRecipeModal(true)
    } catch (err) {
      setSearchError(err.message || 'Could not generate recipe')
    } finally {
      setSearching(false)
    }
  }

  async function saveRecipe() {
    if (!recipe) return
    setSavingRecipe(true)
    await supabase.from('recipes').insert({
      household_id: profile?.household_id || null,
      created_by: user.id,
      name: recipe.name, description: recipe.description,
      source_url: mode === 'url' ? input.trim() : null,
      source_query: mode === 'search' ? input.trim() : null,
      servings: recipe.servings, prep_time_min: recipe.prep_time_min,
      cook_time_min: recipe.cook_time_min, ingredients: recipe.ingredients,
      instructions: recipe.instructions, tags: recipe.tags || [],
    })
    setSavingRecipe(false)
    setShowRecipeModal(false)
    setRecipe(null)
    setInput('')
    loadAll()
  }

  async function addMissingToShoppingList() {
    if (!recipe) return
    const missing = recipe.ingredients.filter(i => i.match_status === 'missing' || i.match_status === 'low')
    await supabase.from('shopping_list_items').insert(
      missing.map(i => ({
        name: i.name, quantity: i.quantity, unit: i.unit,
        created_by: user.id, household_id: profile?.household_id || null,
      }))
    )
  }

  function openSavedRecipe(rec) {
    const reChecked = {
      ...rec,
      ingredients: rec.ingredients.map(ing => {
        const match = inventory.find(inv =>
          inv.name.toLowerCase().includes(ing.name.toLowerCase()) ||
          ing.name.toLowerCase().includes(inv.name.toLowerCase())
        )
        if (!match) return { ...ing, match_status: 'missing', matched_inventory_id: null }
        const status = match.quantity < ing.quantity ? 'low' : 'have'
        return { ...ing, match_status: status, matched_inventory_id: match.id }
      }),
    }
    setRecipe(reChecked)
    setShowRecipeModal(true)
  }

  const missingCount = recipe?.ingredients.filter(i => i.match_status === 'missing').length || 0
  const lowCount = recipe?.ingredients.filter(i => i.match_status === 'low').length || 0

  // ── Expiring items count (for hero context) ───────────────────────
  const now = new Date(); now.setHours(0, 0, 0, 0)
  const expiringCount = inventory.filter(i => {
    if (!i.expiry_date) return false
    const exp = new Date(i.expiry_date); exp.setHours(0, 0, 0, 0)
    return Math.floor((exp - now) / 86400000) <= 7
  }).length

  return (
    <div className="recipes-page">
      <div className="page-header">
        <h1>Recipes</h1>
      </div>

      {/* ── Hero: Generate from inventory ─────────────────────── */}
      <div className="generate-hero card">
        <div className="generate-hero-content">
          <div className="generate-hero-text">
            <h2 className="generate-hero-title">What can I make tonight?</h2>
            <p className="generate-hero-sub">
              {inventory.length === 0
            ? 'Add items to your inventory first to get personalised recipe suggestions based on what you have.'
            : <>Claude looks at your {inventory.length} inventory items{expiringCount > 0 && <span className="expiring-hint"> · <span className="expiring-count">{expiringCount} expiring soon</span></span>} and suggests 3 recipes — prioritising ingredients that need to be used up.</>
          }
            </p>
          </div>
          <button
            className="btn btn-primary btn-generate"
            onClick={handleGenerateSuggestions}
            disabled={suggestionsLoading || loading}
          >
            {suggestionsLoading
              ? <><span className="spinner" /> Finding recipes…</>
              : <><span className="generate-sparkle">✨</span> Generate Recipes</>}
          </button>
        </div>
        {suggestionsError && <div className="error-msg" style={{ marginTop: '1rem', marginBottom: 0 }}>{suggestionsError}</div>}
      </div>

      {/* ── Suggestion cards ─────────────────────────────────── */}
      {suggestions.length > 0 && (
        <div className="suggestions-section">
          <h3 className="section-title">Suggested for you</h3>
          <div className="suggestions-list">
            {suggestions.map((rec, idx) => {
              const isExpanded = expandedIdx === idx
              const missingIngCount = rec.ingredients.filter(i => !i.in_inventory).length
              return (
                <div key={idx} className={`suggestion-card card${isExpanded ? ' expanded' : ''}`}>
                  <div className="suggestion-header" onClick={() => setExpandedIdx(isExpanded ? null : idx)}>
                    <div className="suggestion-top-row">
                      <h3 className="suggestion-name">{rec.name}</h3>
                      <span className={`difficulty-badge diff-${rec.difficulty.toLowerCase()}`}>
                        {rec.difficulty}
                      </span>
                    </div>
                    <div className="suggestion-meta-row">
                      <span className="suggestion-meta-item">⏱ {rec.cook_time_mins} min</span>
                      {rec.uses_expiring?.length > 0 && (
                        <span className="suggestion-expiring">
                          Uses expiring:&nbsp;
                          {rec.uses_expiring.map(e => (
                            <span key={e} className="expiring-pill">{e}</span>
                          ))}
                        </span>
                      )}
                    </div>
                    <span className="expand-chevron">{isExpanded ? '▲' : '▼'}</span>
                  </div>

                  {isExpanded && (
                    <div className="suggestion-body">
                      <h4 className="recipe-section-title">Ingredients</h4>
                      <ul className="suggestion-ingredients">
                        {rec.ingredients.map((ing, i) => (
                          <li key={i} className={`sug-ing ${!ing.in_inventory ? 'sug-ing-missing' : ing.expiring ? 'sug-ing-expiring' : 'sug-ing-have'}`}>
                            <span className="sug-ing-icon">
                              {!ing.in_inventory ? '✗' : ing.expiring ? '⚠' : '✓'}
                            </span>
                            <span className="sug-ing-text">
                              <strong>{ing.quantity} {ing.unit}</strong> {ing.name}
                            </span>
                            {ing.expiring && <span className="sug-tag sug-tag-expiring">expiring</span>}
                            {!ing.in_inventory && <span className="sug-tag sug-tag-missing">need to buy</span>}
                          </li>
                        ))}
                      </ul>

                      <h4 className="recipe-section-title">Instructions</h4>
                      <ol className="suggestion-steps">
                        {rec.steps.map((step, i) => <li key={i}>{step}</li>)}
                      </ol>
                    </div>
                  )}

                  <div className="suggestion-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => openPlannerFor(rec)}>
                      📅 Add to Planner
                    </button>
                    {missingIngCount > 0 && (
                      <button
                        className={`btn btn-sm ${justAdded === idx ? 'btn-success' : 'btn-ghost'}`}
                        onClick={() => addMissingIngredients(rec, idx)}
                        disabled={addingMissing === idx}
                      >
                        {addingMissing === idx
                          ? <span className="spinner" />
                          : justAdded === idx
                            ? '✓ Added to list'
                            : `+ Add ${missingIngCount} missing to shopping list`}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Search / URL ──────────────────────────────────────── */}
      <div className="recipe-search-card card">
        <h3 className="search-section-title">Find a specific recipe</h3>
        <div className="recipe-mode-tabs">
          <button className={'tab-btn' + (mode === 'search' ? ' active' : '')} onClick={() => setMode('search')}>🔍 Search</button>
          <button className={'tab-btn' + (mode === 'url' ? ' active' : '')} onClick={() => setMode('url')}>🔗 Paste URL</button>
        </div>
        <div className="recipe-search-input-row">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={mode === 'search' ? 'e.g. quick chicken curry for 4' : 'https://www.example.com/recipes/...'}
            disabled={searching}
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={searching || !input.trim()}>
            {searching ? <><span className="spinner" /> Working…</> : 'Get Recipe'}
          </button>
        </div>
        {searchError && <div className="error-msg">{searchError}</div>}
        <p className="recipe-search-hint">We'll fetch the recipe and check what's already in your inventory. Supports most recipe sites including Taste, Delish, BBC Food, and AllRecipes.</p>
      </div>

      {/* ── Saved Recipes ─────────────────────────────────────── */}
      <div className="recipes-section">
        <h3 className="section-title">Saved Recipes ({savedRecipes.length})</h3>
        {loading ? (
          <div className="loading-state"><span className="spinner" /> Loading…</div>
        ) : savedRecipes.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">🍳</span>
            <p>No saved recipes yet. Search or paste a URL above to get started.</p>
          </div>
        ) : (
          <div className="recipes-grid">
            {savedRecipes.map(rec => (
              <div key={rec.id} className="recipe-card card" onClick={() => openSavedRecipe(rec)}>
                <h4 className="recipe-card-name">{rec.name}</h4>
                {rec.description && <p className="recipe-card-desc">{rec.description}</p>}
                <div className="recipe-card-meta">
                  {rec.servings && <span>🍽 {rec.servings}</span>}
                  {rec.cook_time_min && <span>⏱ {rec.cook_time_min}m</span>}
                  <span>{rec.ingredients?.length || 0} ingredients</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Recipe detail modal (search/URL/saved) ────────────── */}
      <Modal
        isOpen={showRecipeModal}
        onClose={() => { setShowRecipeModal(false); setRecipe(null) }}
        title={recipe?.name || 'Recipe'}
      >
        {recipe && (
          <div className="recipe-detail">
            {recipe.description && <p className="recipe-desc">{recipe.description}</p>}
            <div className="recipe-meta-row">
              {recipe.servings && <span className="badge badge-neutral">🍽 {recipe.servings} servings</span>}
              {recipe.prep_time_min && <span className="badge badge-neutral">⏱ {recipe.prep_time_min}m prep</span>}
              {recipe.cook_time_min && <span className="badge badge-neutral">🔥 {recipe.cook_time_min}m cook</span>}
            </div>
            <div className="recipe-summary">
              {missingCount === 0 && lowCount === 0
                ? <div className="recipe-summary-good">✓ You have everything you need!</div>
                : <div className="recipe-summary-warn">Missing {missingCount} item{missingCount !== 1 ? 's' : ''}{lowCount > 0 && `, low on ${lowCount}`}</div>}
            </div>
            <h4 className="recipe-section-title">Ingredients</h4>
            <ul className="ingredients-list">
              {recipe.ingredients.map((ing, i) => (
                <li key={i} className={'ingredient-row ingredient-' + ing.match_status}>
                  <span className="ingredient-status-icon">
                    {ing.match_status === 'have' ? '✓' : ing.match_status === 'low' ? '⚠' : '✗'}
                  </span>
                  <span className="ingredient-text">
                    <strong>{ing.quantity} {ing.unit}</strong> {ing.name}
                    {ing.notes && <em> — {ing.notes}</em>}
                  </span>
                </li>
              ))}
            </ul>
            <h4 className="recipe-section-title">Instructions</h4>
            <ol className="instructions-list">
              {recipe.instructions.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
            <div className="modal-footer">
              {(missingCount > 0 || lowCount > 0) && (
                <button className="btn btn-ghost" onClick={addMissingToShoppingList}>
                  + Add missing to shopping list
                </button>
              )}
              <button className="btn btn-primary" onClick={saveRecipe} disabled={savingRecipe}>
                {savingRecipe ? <span className="spinner" /> : null}
                Save Recipe
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Meal planner modal ────────────────────────────────── */}
      <Modal
        isOpen={!!plannerModal}
        onClose={() => setPlannerModal(null)}
        title="Add to Meal Planner"
      >
        {plannerModal && (
          plannerSuccess ? (
            <div className="planner-success">
              <span className="planner-success-icon">✓</span>
              <p><strong>{plannerModal.recipe.name}</strong> added to your planner!</p>
            </div>
          ) : (
            <>
              <p className="planner-recipe-name">"{plannerModal.recipe.name}"</p>
              <div className="form-group">
                <label>Date</label>
                <input type="date" value={plannerDate} onChange={e => setPlannerDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Meal</label>
                <select value={plannerMealType} onChange={e => setPlannerMealType(e.target.value)}>
                  {MEAL_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                </select>
              </div>
              <div className="modal-footer">
                <button className="btn btn-ghost" onClick={() => setPlannerModal(null)}>Cancel</button>
                <button className="btn btn-primary" onClick={saveToPlannerConfirm} disabled={savingPlan || !plannerDate}>
                  {savingPlan ? <span className="spinner" /> : null}
                  Add to Planner
                </button>
              </div>
            </>
          )
        )}
      </Modal>
    </div>
  )
}
