import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import Modal from '../components/Modal'
import './ShoppingList.css'

// Shopping list has extra categories inventory doesn't need
const CATEGORIES = [
  'produce','dairy','meat','grains','canned','frozen',
  'beverages','snacks','condiments','bakery',
  'household','personal care','other',
]
const UNITS = ['unit','g','kg','ml','L','oz','lb','cup','tbsp','tsp','pack','bunch','can','bottle','box']

const blankForm = { name: '', quantity: 1, unit: 'unit', category: 'other', description: '' }

function catLabel(cat) {
  if (!cat || cat === 'null' || cat === 'uncategorised') return 'Uncategorised'
  return cat.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function normCat(item) {
  return item.category || 'uncategorised'
}

export default function ShoppingList({ user }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState(blankForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [autoAdding, setAutoAdding] = useState(false)
  const [profile, setProfile] = useState(null)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('')
  const [sortOrder, setSortOrder] = useState('default')
  const [editingQty, setEditingQty] = useState(null) // { id, quantity, unit }
  const [lowStockPreview, setLowStockPreview] = useState(null) // { count, toAdd }
  const [wooliesToast, setWooliesToast] = useState(false)
  const [showWooliesModal, setShowWooliesModal] = useState(false)
  const [wooliesShopStarted, setWooliesShopStarted] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [notifyWarning, setNotifyWarning] = useState('')
  const [doneToast, setDoneToast] = useState(false)

  useEffect(() => { loadProfile() }, [user])
  useEffect(() => { if (profile !== undefined) loadItems() }, [profile])

  async function loadProfile() {
    const { data } = await supabase
      .from('user_profiles')
      .select('household_id, name, display_name')
      .eq('id', user.id)
      .single()
    setProfile(data)
  }

  const loadItems = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('shopping_list_items').select('*').order('category').order('name')
    if (profile?.household_id) query = query.eq('household_id', profile.household_id)
    else query = query.eq('created_by', user.id)
    const { data } = await query
    setItems(data || [])
    setLoading(false)
  }, [user.id, profile])

  async function togglePurchased(item) {
    const next = !item.is_purchased
    await supabase.from('shopping_list_items').update({ is_purchased: next }).eq('id', item.id)
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_purchased: next } : i))
  }

  async function deleteItem(id) {
    await supabase.from('shopping_list_items').delete().eq('id', id)
    setItems(prev => prev.filter(i => i.id !== id))
  }

  async function clearPurchased() {
    const ids = items.filter(i => i.is_purchased).map(i => i.id)
    if (!ids.length) return
    if (!confirm(`Clear ${ids.length} purchased item(s)?`)) return
    await supabase.from('shopping_list_items').delete().in('id', ids)
    setItems(prev => prev.filter(i => !i.is_purchased))
  }

  // ── Auto-add: preview then confirm ──────────────────────────────
  async function handleAutoAddClick() {
    setAutoAdding(true)
    let query = supabase.from('inventory_items').select('name, category, unit, quantity, low_threshold')
    if (profile?.household_id) query = query.eq('household_id', profile.household_id)
    else query = query.eq('created_by', user.id)
    const { data: lowItems } = await query
    const low = (lowItems || []).filter(i => i.quantity <= i.low_threshold)
    setAutoAdding(false)
    if (!low.length) { alert('No low stock items found.'); return }
    const existingNames = new Set(items.map(i => i.name.toLowerCase()))
    const toAdd = low
      .filter(i => !existingNames.has(i.name.toLowerCase()))
      .map(i => ({
        name: i.name, category: i.category || 'other', unit: i.unit || 'unit',
        quantity: 1, auto_added: true, created_by: user.id,
        household_id: profile?.household_id || null,
      }))
    if (!toAdd.length) { alert('All low stock items are already on the list.'); return }
    setLowStockPreview({ count: toAdd.length, toAdd })
  }

  async function confirmAutoAdd() {
    if (!lowStockPreview) return
    setAutoAdding(true)
    await supabase.from('shopping_list_items').insert(lowStockPreview.toAdd)
    setAutoAdding(false)
    setLowStockPreview(null)
    loadItems()
  }

  async function handleAdd() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('shopping_list_items').insert({
      ...form, quantity: Number(form.quantity), created_by: user.id,
      household_id: profile?.household_id || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setShowModal(false)
    setForm(blankForm)
    loadItems()
  }

  // ── Notifications ────────────────────────────────────────────────
  async function sendNotification(type, notifyItems) {
    if (!profile?.household_id) return

    const { data: members } = await supabase
      .from('household_members')
      .select('user_email, user_name')
      .eq('household_id', profile.household_id)
      .neq('user_email', user.email)

    if (!members?.length) return

    const senderName =
      profile?.display_name ||
      (profile?.name ? profile.name.trim().split(/\s+/)[0] : '') ||
      user.email?.split('@')[0] ||
      'A household member'

    const { error } = await supabase.functions.invoke('send-notification', {
      body: {
        type,
        recipients: members.map(m => ({ email: m.user_email, name: m.user_name })),
        items: notifyItems.map(i => ({ name: i.name, quantity: i.quantity ?? 1, unit: i.unit || 'unit' })),
        senderName,
      },
    })

    if (error) throw new Error(error.message)
  }

  // ── Woolworths prompt ────────────────────────────────────────────
  function formatItemLine(item) {
    const qty = item.quantity ?? 1
    const unit = item.unit && item.unit !== 'unit' ? `${qty} ${item.unit}` : `x${qty}`
    return `- ${item.name} ${unit}`
  }

  async function shopOnWoolworths() {
    const unpurchased = items.filter(i => !i.is_purchased)
    if (!unpurchased.length) return

    // Send approval email first (non-blocking on failure)
    setNotifying(true)
    try {
      await sendNotification('shopping_approval', unpurchased)
    } catch (err) {
      console.error('Approval notification failed:', err)
      setNotifyWarning('Prompt copied but household notifications could not be sent.')
      setTimeout(() => setNotifyWarning(''), 5000)
    }
    setNotifying(false)

    // Copy prompt to clipboard
    const itemLines = unpurchased.map(formatItemLine).join('\n')
    const prompt = `I am already logged into Woolworths at woolworths.com.au. Please add the following items to my cart as efficiently as possible using the Woolworths Lists feature.

Steps:
1. Go to https://www.woolworths.com.au
2. Find the Lists feature (under the account menu)
3. Create a new list called "KitAura Shop"
4. Add all items below to the list
5. Once all items are in the list, add them all to the cart
6. Navigate to the cart and tell me what was successfully added
7. STOP at the cart — do not proceed to checkout under any circumstances

For each item:
- Pick the best value option that matches the description
- If an exact match isn't available, pick the closest equivalent and tell me
- If something is unavailable, skip it and flag it in your summary

Shopping list:
${itemLines}

At the end give me:
- What was added successfully
- Any substitutions made
- What couldn't be found
- The estimated cart total`

    await navigator.clipboard.writeText(prompt)

    setWooliesShopStarted(true)
    setWooliesToast(true)
    setTimeout(() => setWooliesToast(false), 4000)

    if (!localStorage.getItem('ka-woolies-seen')) {
      setShowWooliesModal(true)
    }
  }

  async function markShoppingDone() {
    const toMark = items.filter(i => !i.is_purchased)

    // Send completion email (non-blocking on failure)
    setNotifying(true)
    try {
      await sendNotification('shopping_complete', toMark)
    } catch (err) {
      console.error('Completion notification failed:', err)
      setNotifyWarning('Shopping updated but household notifications could not be sent.')
      setTimeout(() => setNotifyWarning(''), 5000)
    }
    setNotifying(false)

    // Mark everything as purchased
    if (toMark.length) {
      await supabase
        .from('shopping_list_items')
        .update({ is_purchased: true })
        .in('id', toMark.map(i => i.id))
      setItems(prev => prev.map(i => ({ ...i, is_purchased: true })))
    }

    setWooliesShopStarted(false)
    setDoneToast(true)
    setTimeout(() => setDoneToast(false), 5000)
  }

  // ── Inline qty edit ──────────────────────────────────────────────
  async function saveQtyEdit(itemId) {
    if (!editingQty || editingQty.id !== itemId) return
    const qty = Number(editingQty.quantity)
    if (isNaN(qty) || qty <= 0) { setEditingQty(null); return }
    await supabase.from('shopping_list_items')
      .update({ quantity: qty, unit: editingQty.unit })
      .eq('id', itemId)
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, quantity: qty, unit: editingQty.unit } : i))
    setEditingQty(null)
  }

  // ── Derived ──────────────────────────────────────────────────────
  let filtered = items.filter(i => {
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase())
    const matchCat    = !filterCategory || normCat(i) === filterCategory
    return matchSearch && matchCat
  })

  if (sortOrder === 'alpha') {
    filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name))
  } else if (sortOrder === 'low-stock-first') {
    filtered = [...filtered].sort((a, b) => {
      if (a.auto_added && !b.auto_added) return -1
      if (!a.auto_added && b.auto_added) return 1
      return a.name.localeCompare(b.name)
    })
  } else if (sortOrder === 'category') {
    filtered = [...filtered].sort((a, b) => normCat(a).localeCompare(normCat(b)) || a.name.localeCompare(b.name))
  }

  const grouped = {}
  filtered.forEach(item => {
    const key = normCat(item)
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(item)
  })
  const sortedCategories = Object.keys(grouped).sort((a, b) => {
    if (a === 'uncategorised') return 1
    if (b === 'uncategorised') return -1
    return a.localeCompare(b)
  })

  const purchasedCount = items.filter(i => i.is_purchased).length
  const remaining      = items.filter(i => !i.is_purchased).length
  const progressPct    = items.length > 0 ? Math.round((purchasedCount / items.length) * 100) : 0
  const allPurchased   = items.length > 0 && purchasedCount === items.length

  return (
    <div className="shopping-page">
      <div className="page-header">
        <h1>Shopping List</h1>
        <div className="page-header-actions">
          {wooliesShopStarted && !allPurchased && (
            <button
              className="btn btn-done"
              onClick={markShoppingDone}
              disabled={notifying}
            >
              {notifying ? <><span className="spinner" /> Notifying…</> : '✓ Mark Shopping as Done'}
            </button>
          )}
          {remaining > 0 && (
            <button
              className="btn btn-woolies"
              onClick={shopOnWoolworths}
              disabled={notifying}
            >
              {notifying ? <><span className="spinner" style={{ borderTopColor: '#1db954' }} /> Notifying household…</> : '🛒 Shop on Woolworths'}
            </button>
          )}
          {purchasedCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={clearPurchased}>
              🗑️ Clear Purchased ({purchasedCount})
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={handleAutoAddClick}
            disabled={autoAdding}
            title="Scans your inventory for low stock items and adds them to this list"
          >
            {autoAdding ? <span className="spinner" /> : '⚠️'} Auto-Add Low Stock
          </button>
          <button className="btn btn-primary" onClick={() => { setForm(blankForm); setError(''); setShowModal(true) }}>
            + Add Item
          </button>
        </div>
      </div>

      {/* Auto-add confirmation bar */}
      {lowStockPreview && (
        <div className="auto-add-confirm">
          <span>Add <strong>{lowStockPreview.count}</strong> low stock item{lowStockPreview.count !== 1 ? 's' : ''} to the list?</span>
          <div className="auto-add-confirm-actions">
            <button className="btn btn-primary btn-sm" onClick={confirmAutoAdd} disabled={autoAdding}>
              {autoAdding ? <span className="spinner" /> : 'Add to List'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setLowStockPreview(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label stat-label--bright">Total Items</div>
          <div className="stat-value">{items.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label stat-label--bright">Purchased</div>
          <div className="stat-value" style={{ color: purchasedCount > 0 ? 'var(--success)' : 'inherit' }}>{purchasedCount}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label stat-label--bright">Remaining</div>
          <div className="stat-value" style={{ color: remaining > 0 ? 'var(--accent-light)' : 'inherit' }}>{remaining}</div>
        </div>
      </div>

      {/* Progress bar */}
      {items.length > 0 && (
        <div className="shopping-progress-wrap">
          {allPurchased ? (
            <div className="shopping-complete">Shopping complete! 🎉</div>
          ) : (
            <>
              <div className="shopping-progress-bar">
                <div className="shopping-progress-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <span className="shopping-progress-label">
                {purchasedCount} of {items.length} items — {progressPct}%
              </span>
            </>
          )}
        </div>
      )}

      {/* Filter + sort bar */}
      {items.length > 0 && (
        <div className="shopping-filter-row">
          <input
            className="filter-input"
            placeholder="Search items…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="filter-select" value={filterCategory} onChange={e => setFilterCategory(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
            {items.some(i => !i.category) && <option value="uncategorised">Uncategorised</option>}
          </select>
          <select className="filter-select" value={sortOrder} onChange={e => setSortOrder(e.target.value)}>
            <option value="default">Sort: Default</option>
            <option value="alpha">A – Z</option>
            <option value="low-stock-first">Low Stock First</option>
            <option value="category">By Category</option>
          </select>
          {(search || filterCategory) && (
            <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterCategory('') }}>Clear</button>
          )}
        </div>
      )}

      {loading ? (
        <div className="loading-state"><span className="spinner" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="shopping-empty">
          <span style={{ fontSize: '3rem', display: 'block', marginBottom: '0.75rem' }}>🛒</span>
          <h2>Your shopping list is empty</h2>
          <p>Add items manually, or use Auto-Add to pull in everything that's running low in your inventory.</p>
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => { setForm(blankForm); setError(''); setShowModal(true) }}>+ Add Item</button>
            <button className="btn btn-ghost" onClick={handleAutoAddClick} disabled={autoAdding}>⚠️ Auto-Add Low Stock</button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="shopping-empty">
          <p>No items match your filter.</p>
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterCategory('') }}>Clear filter</button>
        </div>
      ) : (
        <div className="shopping-grid">
          {sortedCategories.map(cat => (
            <div key={cat} className="shopping-group">
              <div className="shopping-group-header">
                <span className="shopping-group-name">{catLabel(cat)}</span>
                <span className="shopping-group-count">{grouped[cat].length}</span>
              </div>
              <div className="shopping-items">
                {grouped[cat].map(item => (
                  <div
                    key={item.id}
                    className={[
                      'shopping-item',
                      item.is_purchased ? 'purchased' : '',
                      item.auto_added   ? 'low-stock-item' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <input
                      type="checkbox"
                      checked={item.is_purchased}
                      onChange={() => togglePurchased(item)}
                      className={item.is_purchased ? 'checkbox-done' : ''}
                    />
                    <div className="shopping-item-info">
                      <div className="shopping-item-name-row">
                        <span className="shopping-item-name">{item.name}</span>
                        {item.auto_added && !item.is_purchased && (
                          <span className="low-stock-pill">low stock</span>
                        )}
                      </div>

                      {/* Quantity — inline editable */}
                      {editingQty?.id === item.id ? (
                        <div className="qty-edit-inline">
                          <input
                            type="number"
                            min="0.1"
                            step="0.1"
                            value={editingQty.quantity}
                            className="qty-edit-input"
                            autoFocus
                            onChange={e => setEditingQty(q => ({ ...q, quantity: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveQtyEdit(item.id)
                              if (e.key === 'Escape') setEditingQty(null)
                            }}
                            onBlur={() => saveQtyEdit(item.id)}
                          />
                          <select
                            value={editingQty.unit}
                            className="qty-edit-unit"
                            onChange={e => setEditingQty(q => ({ ...q, unit: e.target.value }))}
                            onBlur={() => saveQtyEdit(item.id)}
                          >
                            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                        </div>
                      ) : (
                        <span className="shopping-item-qty">
                          {item.quantity} {item.unit}
                          {!item.is_purchased && (
                            <button
                              className="qty-edit-btn"
                              onClick={e => { e.stopPropagation(); setEditingQty({ id: item.id, quantity: item.quantity, unit: item.unit || 'unit' }) }}
                              title="Edit quantity"
                            >✏</button>
                          )}
                        </span>
                      )}

                      {item.description && <span className="shopping-item-desc">{item.description}</span>}
                      {item.recipe_tag   && <span className="badge badge-accent" style={{ fontSize: '0.7rem' }}>{item.recipe_tag}</span>}
                    </div>
                    <button className="btn-icon danger" onClick={() => deleteItem(item.id)}>🗑️</button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Done toast */}
      {doneToast && (
        <div className="woolies-toast woolies-toast--done">
          <span className="woolies-toast-icon">✓</span>
          <span>Shopping marked as complete — household notified!</span>
        </div>
      )}

      {/* Warning toast — notification failure */}
      {notifyWarning && (
        <div className="woolies-toast woolies-toast--warn">
          <span className="woolies-toast-icon woolies-toast-icon--warn">!</span>
          <span>{notifyWarning}</span>
        </div>
      )}

      {/* Woolworths instructions modal — first use only */}
      <Modal
        isOpen={showWooliesModal}
        onClose={() => { setShowWooliesModal(false); localStorage.setItem('ka-woolies-seen', '1') }}
        title="How to shop on Woolworths with Claude"
      >
        <div className="woolies-instructions">
          <p className="woolies-instructions-intro">The prompt has been copied to your clipboard. Here's how to use it:</p>
          <ol className="woolies-steps">
            <li>Open <strong>Claude in Chrome</strong> (the Claude sidebar in your browser)</li>
            <li>Make sure you're <strong>logged into woolworths.com.au</strong> first</li>
            <li><strong>Paste the copied prompt</strong> and press Enter</li>
            <li>Claude will add everything to your Woolworths cart automatically</li>
            <li><strong>Review your cart</strong> and complete checkout yourself</li>
          </ol>
          <p className="woolies-disclaimer">Claude will stop at the cart and never proceed to checkout on your behalf.</p>
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-primary"
            onClick={() => { setShowWooliesModal(false); localStorage.setItem('ka-woolies-seen', '1') }}
          >
            Got it
          </button>
        </div>
      </Modal>

      {/* Success toast */}
      {wooliesToast && (
        <div className="woolies-toast">
          <span className="woolies-toast-icon">✓</span>
          <span>Copied! Paste into Claude in Chrome to start shopping.</span>
        </div>
      )}

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Add Item">
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>Name</label>
          <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Eggs" autoFocus />
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Quantity</label>
            <input type="number" min="0.1" step="0.1" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Unit</label>
            <select value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>
        <div className="form-group">
          <label>Category</label>
          <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            {CATEGORIES.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Description (optional)</label>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="e.g. organic, name-brand…" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            Add to List
          </button>
        </div>
      </Modal>
    </div>
  )
}
