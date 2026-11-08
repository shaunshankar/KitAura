// Shared by the MCP tools: unit conversion, pantry name matching and formatting.

export const text = s => ({ content: [{ type: 'text', text: s }] })
export const fail = s => ({ content: [{ type: 'text', text: s }], isError: true })

// Same lists as the app's pages
export const SHOPPING_CATEGORIES = [
  'produce', 'dairy', 'meat', 'grains', 'canned', 'frozen',
  'beverages', 'snacks', 'condiments', 'bakery',
  'household', 'personal care', 'other',
]
export const PANTRY_CATEGORIES = ['produce', 'dairy', 'meat', 'grains', 'canned', 'frozen', 'beverages', 'snacks', 'condiments', 'bakery', 'other']
export const LOCATIONS = ['pantry', 'fridge', 'freezer']
export const UNITS = ['unit', 'g', 'kg', 'ml', 'L', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'pack', 'bunch', 'can', 'bottle', 'box']
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// ── Units ─────────────────────────────────────────────────────────
// Metric cup (250 ml) and international tablespoon (15 ml)
const MASS = { g: 1, kg: 1000, oz: 28.3495, lb: 453.592 }
const VOLUME = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 250 }
const COUNT_ALIASES = { '': 'unit', unit: 'unit', units: 'unit', ea: 'unit', each: 'unit', x: 'unit' }

const normUnit = u => {
  const s = String(u ?? '').trim().toLowerCase()
  return COUNT_ALIASES[s] ?? s
}

// Converts qty from one unit to another, or null when they aren't comparable
export function convert(qty, from, to) {
  const a = normUnit(from)
  const b = normUnit(to)
  if (a === b) return qty
  if (a in MASS && b in MASS) return (qty * MASS[a]) / MASS[b]
  if (a in VOLUME && b in VOLUME) return (qty * VOLUME[a]) / VOLUME[b]
  return null
}

export const round = n => Math.round(n * 1000) / 1000

export function qtyLabel(quantity, unit) {
  const q = round(Number(quantity))
  return !unit || normUnit(unit) === 'unit' ? `${q} ×` : `${q} ${unit}`
}

// ── Name matching ─────────────────────────────────────────────────
const singular = w =>
  w.endsWith('ies') && w.length > 4 ? w.slice(0, -3) + 'y'
    : w.endsWith('oes') ? w.slice(0, -2)
    : w.endsWith('s') && !w.endsWith('ss') && w.length > 3 ? w.slice(0, -1)
    : w

export const normName = s =>
  String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).map(singular).join(' ')

const containsWords = (hay, needle) => ` ${hay} `.includes(` ${needle} `)

// Pantry items matching an ingredient name, best tier only:
// exact name, then pantry name containing the ingredient, then the reverse.
export function matchPantry(name, pantry) {
  const n = normName(name)
  if (!n) return []
  const tiers = [
    p => normName(p.name) === n,
    p => containsWords(normName(p.name), n),
    p => containsWords(n, normName(p.name)),
  ]
  for (const test of tiers) {
    const hits = pantry.filter(p => normName(p.name) && test(p))
    if (hits.length) return hits
  }
  return []
}

// Amount of a matched set available in the ingredient's unit (null if none convertible)
export function available(matches, unit) {
  let total = null
  for (const p of matches) {
    const q = convert(Number(p.quantity) || 0, p.unit, unit)
    if (q !== null) total = (total ?? 0) + Math.max(0, q)
  }
  return total
}

export const isLow = p => Number(p.quantity) <= Number(p.low_threshold ?? 0)

export function pantryLine(p) {
  const bits = [p.location, p.category, isLow(p) && 'low', p.expiry_date && `expires ${p.expiry_date}`].filter(Boolean)
  return `- ${qtyLabel(p.quantity, p.unit)} ${p.name} (${bits.join(', ')})\n  id: ${p.id}`
}

// Where a new pantry item goes when only its category is known
export const defaultLocation = category =>
  category === 'frozen' ? 'freezer' : category === 'dairy' || category === 'meat' ? 'fridge' : 'pantry'

export const toPantryCategory = c => (PANTRY_CATEGORIES.includes(c) ? c : 'other')

// Scale factor from a recipe's servings to the servings wanted
export const scaleFor = (recipe, servings) =>
  servings && Number(recipe.servings) > 0 ? servings / Number(recipe.servings) : 1
