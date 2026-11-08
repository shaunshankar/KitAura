import { z } from 'zod'
import {
  text, fail, PANTRY_CATEGORIES, SHOPPING_CATEGORIES, LOCATIONS, UNITS, MEAL_TYPES, DATE_RE,
  convert, round, qtyLabel, normName, matchPantry, available, isLow, pantryLine,
  defaultLocation, toPantryCategory, scaleFor,
} from './_kitchen.js'

// Recipes, pantry, cooking and nutrition tools for /api/mcp.
// The pantry is the app's inventory_items table (pantry, fridge and freezer).

const DEFAULT_GOALS = { calories: 2000, protein: 150, carbs: 250, fat: 65 }
const EPSILON = 0.0005

const nutritionSchema = z.object({
  calories: z.number().min(0),
  protein_g: z.number().min(0),
  carbs_g: z.number().min(0),
  fat_g: z.number().min(0),
  fibre_g: z.number().min(0).optional(),
})

const ingredientSchema = z.object({
  name: z.string().min(1).max(120),
  quantity: z.number().min(0).optional().describe('Leave out for "to taste"'),
  unit: z.enum(UNITS).optional().describe('Defaults to unit'),
  category: z.enum(SHOPPING_CATEGORIES).optional().describe('Shopping category, used when adding it to the list'),
  notes: z.string().max(200).optional(),
})

async function loadPantry(supabase, scope) {
  const { data, error } = await scope.filter(supabase.from('inventory_items').select('*')).order('name')
  if (error) throw error
  return data
}

async function loadRecipe(supabase, scope, id) {
  const { data, error } = await scope.filter(supabase.from('recipes').select('*').eq('id', id)).maybeSingle()
  if (error) throw error
  return data
}

function recipeLine(r) {
  const bits = [r.servings && `serves ${r.servings}`, r.tags?.length && r.tags.join(', ')].filter(Boolean)
  return `- ${r.name}${bits.length ? ` (${bits.join('; ')})` : ''}\n  id: ${r.id}`
}

function nutritionLine(n) {
  if (!n) return null
  const fibre = n.fibre_g != null ? `, fibre ${n.fibre_g} g` : ''
  return `${n.calories} kcal, protein ${n.protein_g} g, carbs ${n.carbs_g} g, fat ${n.fat_g} g${fibre}`
}

// Adds to a matching pantry item (same name, convertible unit) or creates one
async function addToPantry(supabase, user, scope, pantry, item) {
  const unit = item.unit || 'unit'
  const match = pantry.find(p => normName(p.name) === normName(item.name) && convert(1, unit, p.unit) !== null)
  if (match) {
    const quantity = round(Number(match.quantity) + convert(item.quantity ?? 1, unit, match.unit))
    const { error } = await supabase.from('inventory_items')
      .update({ quantity, updated_at: new Date().toISOString() }).eq('id', match.id)
    if (error) throw error
    match.quantity = quantity
    return `${match.name}: now ${qtyLabel(quantity, match.unit)}`
  }
  const category = toPantryCategory(item.category)
  const row = {
    name: item.name.trim(),
    quantity: item.quantity ?? 1,
    unit,
    category,
    location: item.location || defaultLocation(category),
    low_threshold: item.low_threshold ?? 0,
    expiry_date: item.expiry_date || null,
    is_fresh_produce: category === 'produce',
    created_by: user.id,
    household_id: scope.householdId,
  }
  const { data, error } = await supabase.from('inventory_items').insert(row).select('*').single()
  if (error) throw error
  pantry.push(data)
  return `${data.name}: added ${qtyLabel(data.quantity, data.unit)} (${data.location})`
}

export { addToPantry, loadPantry }

export function registerKitchenTools(server, supabase, user, scope, today) {
  // ── Recipes ─────────────────────────────────────────────────────
  server.registerTool('list_recipes', {
    title: 'List saved recipes',
    description: 'List saved recipes, optionally searching by name or tag.',
    inputSchema: { search: z.string().max(100).optional() },
    annotations: { readOnlyHint: true },
  }, async ({ search }) => {
    const { data, error } = await scope.filter(supabase.from('recipes')
      .select('id, name, servings, tags')).order('name')
    if (error) return fail(error.message)
    const q = normName(search)
    const hits = q ? data.filter(r => normName(r.name).includes(q) || (r.tags || []).some(t => normName(t).includes(q))) : data
    if (!hits.length) return text(search ? `No saved recipe matches "${search}".` : 'No saved recipes yet.')
    return text(`${hits.length} recipe${hits.length === 1 ? '' : 's'}:\n${hits.map(recipeLine).join('\n')}`)
  })

  server.registerTool('get_recipe', {
    title: 'Get recipe',
    description: 'Show one saved recipe with its ingredients, method, servings and nutrition per serving.',
    inputSchema: { id: z.string().uuid().describe('From list_recipes') },
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    const r = await loadRecipe(supabase, scope, id)
    if (!r) return fail('No recipe with that id. Call list_recipes.')
    const lines = [`${r.name}${r.servings ? ` (serves ${r.servings})` : ''}`, `id: ${r.id}`]
    if (r.description) lines.push(r.description)
    if (r.tags?.length) lines.push(`Tags: ${r.tags.join(', ')}`)
    if (r.source_url) lines.push(`Source: ${r.source_url}`)
    const n = nutritionLine(r.nutrition)
    lines.push(`Nutrition per serving: ${n || 'not set'}`)
    lines.push('', 'Ingredients:')
    for (const i of r.ingredients || []) {
      const qty = i.quantity ? `${qtyLabel(i.quantity, i.unit)} ` : ''
      lines.push(`- ${qty}${i.name}${i.notes ? ` (${i.notes})` : ''}`)
    }
    if (r.instructions?.length) {
      lines.push('', 'Method:')
      r.instructions.forEach((s, n) => lines.push(`${n + 1}. ${s}`))
    }
    return text(lines.join('\n'))
  })

  server.registerTool('save_recipe', {
    title: 'Save recipe',
    description: 'Save a new recipe, or replace an existing one when id is given. You can write the ingredient list yourself.',
    inputSchema: {
      id: z.string().uuid().optional().describe('Existing recipe to overwrite'),
      name: z.string().min(1).max(150),
      servings: z.number().int().min(1).max(50),
      ingredients: z.array(ingredientSchema).min(1).max(60),
      method: z.array(z.string().max(1000)).max(40).optional().describe('One step per entry'),
      description: z.string().max(500).optional(),
      tags: z.array(z.string().max(40)).max(15).optional(),
      source_url: z.string().url().optional(),
      nutrition_per_serving: nutritionSchema.optional(),
    },
  }, async ({ id, name, servings, ingredients, method, description, tags, source_url, nutrition_per_serving }) => {
    const row = {
      name: name.trim(),
      servings,
      ingredients: ingredients.map(i => ({
        name: i.name.trim(), quantity: i.quantity ?? null, unit: i.unit || 'unit',
        category: i.category || 'other', notes: i.notes || null,
      })),
      instructions: method || [],
      description: description || null,
      tags: tags || [],
      source_url: source_url || null,
      nutrition: nutrition_per_serving || null,
    }
    let result
    if (id) {
      result = await scope.filter(supabase.from('recipes').update(row).eq('id', id)).select('id, name, servings, tags').maybeSingle()
      if (!result.error && !result.data) return fail('No recipe with that id. Call list_recipes.')
    } else {
      result = await supabase.from('recipes')
        .insert({ ...row, created_by: user.id, household_id: scope.householdId })
        .select('id, name, servings, tags').single()
    }
    if (result.error) return fail(result.error.message)
    return text(`${id ? 'Updated' : 'Saved'}:\n${recipeLine(result.data)}`)
  })

  // ── Pantry ──────────────────────────────────────────────────────
  server.registerTool('view_pantry', {
    title: 'View pantry',
    description: 'List food on hand across the pantry, fridge and freezer.',
    inputSchema: {
      location: z.enum(LOCATIONS).optional(),
      search: z.string().max(100).optional().describe('Filter by name'),
      low_only: z.boolean().optional().describe('Only items at or below their low-stock level'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ location, search, low_only = false }) => {
    let items = (await loadPantry(supabase, scope)).filter(p => Number(p.quantity) > 0 || low_only)
    if (location) items = items.filter(p => p.location === location)
    if (search) items = matchPantry(search, items)
    if (low_only) items = items.filter(isLow)
    if (!items.length) return text('No matching pantry items.')
    return text(`${items.length} item${items.length === 1 ? '' : 's'}:\n${items.map(pantryLine).join('\n')}`)
  })

  server.registerTool('update_pantry', {
    title: 'Update pantry',
    description:
      'Change what is on hand. add: increase an item with the same name, or create it. ' +
      'set: change fields of an item (by id). remove: delete an item, or reduce it by quantity.',
    inputSchema: {
      changes: z.array(z.object({
        action: z.enum(['add', 'set', 'remove']),
        id: z.string().uuid().optional().describe('Required for set and remove (from view_pantry)'),
        name: z.string().min(1).max(120).optional().describe('Required for add'),
        quantity: z.number().min(0).optional(),
        unit: z.enum(UNITS).optional(),
        category: z.enum(PANTRY_CATEGORIES).optional(),
        location: z.enum(LOCATIONS).optional(),
        expiry_date: z.string().regex(DATE_RE).optional(),
        low_threshold: z.number().min(0).optional().describe('Quantity at which the item counts as low'),
      })).min(1).max(50),
    },
  }, async ({ changes }) => {
    const pantry = await loadPantry(supabase, scope)
    const done = []
    const problems = []
    for (const c of changes) {
      try {
        if (c.action === 'add') {
          if (!c.name) { problems.push('add needs a name'); continue }
          done.push(await addToPantry(supabase, user, scope, pantry, c))
          continue
        }
        const item = pantry.find(p => p.id === c.id)
        if (!item) { problems.push(`${c.action}: no pantry item with id ${c.id}`); continue }
        if (c.action === 'remove' && c.quantity == null) {
          const { error } = await supabase.from('inventory_items').delete().eq('id', item.id)
          if (error) throw error
          done.push(`${item.name}: removed`)
          continue
        }
        let patch
        if (c.action === 'remove') {
          const less = convert(c.quantity, c.unit || item.unit, item.unit)
          if (less === null) { problems.push(`${item.name}: can't take ${c.unit} from ${item.unit}`); continue }
          patch = { quantity: round(Math.max(0, Number(item.quantity) - less)) }
        } else {
          patch = Object.fromEntries(
            ['name', 'quantity', 'unit', 'category', 'location', 'expiry_date', 'low_threshold']
              .filter(k => c[k] !== undefined).map(k => [k, c[k]])
          )
        }
        const { error } = await supabase.from('inventory_items')
          .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', item.id)
        if (error) throw error
        Object.assign(item, patch)
        done.push(`${item.name}: now ${qtyLabel(item.quantity, item.unit)}${isLow(item) ? ' (low)' : ''}`)
      } catch (err) {
        problems.push(`${c.name || c.id}: ${err.message}`)
      }
    }
    const parts = []
    if (done.length) parts.push(`Updated:\n${done.map(s => `- ${s}`).join('\n')}`)
    if (problems.length) parts.push(`Not changed:\n${problems.map(s => `- ${s}`).join('\n')}`)
    return { ...text(parts.join('\n')), isError: !done.length }
  })

  // ── Do we have the ingredients? ─────────────────────────────────
  server.registerTool('check_recipe_ingredients', {
    title: 'Check recipe ingredients',
    description:
      'Compare a saved recipe with the pantry. Each ingredient comes back as have, low or missing, ' +
      'plus suggested shopping list items for what to buy.',
    inputSchema: {
      recipe_id: z.string().uuid(),
      servings: z.number().positive().max(50).optional().describe("Defaults to the recipe's servings"),
    },
    annotations: { readOnlyHint: true },
  }, async ({ recipe_id, servings }) => {
    const recipe = await loadRecipe(supabase, scope, recipe_id)
    if (!recipe) return fail('No recipe with that id. Call list_recipes.')
    const pantry = (await loadPantry(supabase, scope)).filter(p => Number(p.quantity) > 0)
    const factor = scaleFor(recipe, servings)
    const groups = { missing: [], low: [], have: [] }
    const toBuy = []
    for (const ing of recipe.ingredients || []) {
      const unit = ing.unit || 'unit'
      const needed = ing.quantity ? round(ing.quantity * factor) : null
      const need = needed ? `${qtyLabel(needed, unit)} ` : ''
      const matches = matchPantry(ing.name, pantry)
      const onHand = matches.map(p => `${qtyLabel(p.quantity, p.unit)} ${p.name}`).join(' + ')
      if (!matches.length) {
        groups.missing.push(`- ${need}${ing.name}`)
        toBuy.push({ name: ing.name, quantity: needed || 1, unit: needed ? unit : 'unit', category: ing.category || 'other' })
        continue
      }
      const have = needed ? available(matches, unit) : null
      if (have === null) {
        const note = needed ? ' (units differ, check the amount)' : ''
        groups.have.push(`- ${need}${ing.name}: pantry has ${onHand}${note}`)
      } else if (have + EPSILON < needed) {
        groups.low.push(`- ${need}${ing.name}: pantry has ${onHand}, short ${qtyLabel(needed - have, unit)}`)
        toBuy.push({ name: ing.name, quantity: round(needed - have), unit, category: ing.category || 'other' })
      } else {
        groups.have.push(`- ${need}${ing.name}: pantry has ${onHand}`)
      }
    }
    const lines = [`${recipe.name} for ${round((Number(recipe.servings) || 1) * factor)} serving(s):`]
    for (const k of ['missing', 'low', 'have']) {
      if (groups[k].length) lines.push('', `${k[0].toUpperCase() + k.slice(1)} (${groups[k].length}):`, ...groups[k])
    }
    lines.push('', 'Pantry matches are by name, so sanity-check them before telling the user.')
    if (toBuy.length) {
      lines.push('Suggested add_shopping_items payload (ask the user first):', JSON.stringify(toBuy))
    }
    return text(lines.join('\n'))
  })

  // ── We cooked it ────────────────────────────────────────────────
  server.registerTool('cook_recipe', {
    title: 'Cook recipe',
    description:
      'Take the ingredients for a cooked recipe out of the pantry. Run with dry_run=true first and read the ' +
      'deductions back to the user; then run again without it. Can mark a planned meal cooked and log nutrition.',
    inputSchema: {
      recipe_id: z.string().uuid(),
      servings: z.number().positive().max(50).optional()
        .describe("Servings cooked. Defaults to the planned meal's servings, else the recipe's"),
      meal_id: z.string().uuid().optional().describe('Planned meal to mark as cooked'),
      adjustments: z.array(z.object({
        name: z.string().min(1).max(120),
        quantity: z.number().min(0).describe('Amount actually used; 0 if skipped'),
        unit: z.enum(UNITS).optional(),
      })).max(30).optional().describe('E.g. double the garlic, skipped the cream'),
      dry_run: z.boolean().optional().describe('Show deductions without changing anything'),
      log_nutrition: z.boolean().optional().describe("Also log the recipe's per-serving macros for the user"),
      servings_eaten: z.number().positive().max(10).optional().describe('For log_nutrition, defaults to 1'),
      meal_type: z.enum(MEAL_TYPES).optional().describe("For log_nutrition, defaults to the planned meal's or dinner"),
    },
  }, async ({ recipe_id, servings, meal_id, adjustments = [], dry_run = false, log_nutrition = false, servings_eaten = 1, meal_type }) => {
    const recipe = await loadRecipe(supabase, scope, recipe_id)
    if (!recipe) return fail('No recipe with that id. Call list_recipes.')
    let meal = null
    if (meal_id) {
      const { data, error } = await scope.filter(supabase.from('meal_plans').select('*').eq('id', meal_id)).maybeSingle()
      if (error) return fail(error.message)
      if (!data) return fail('No planned meal with that id. Call view_meal_plan.')
      meal = data
    }
    const cooked = servings ?? (meal?.servings > 0 ? Number(meal.servings) : Number(recipe.servings) || 1)
    const factor = scaleFor(recipe, cooked)

    // What was actually used
    const used = (recipe.ingredients || []).map(i => ({
      name: i.name, unit: i.unit || 'unit', quantity: i.quantity ? round(i.quantity * factor) : null,
    }))
    for (const a of adjustments) {
      const target = used.find(u => normName(u.name) === normName(a.name))
        || used.find(u => normName(u.name).includes(normName(a.name)) || normName(a.name).includes(normName(u.name)))
      if (target) Object.assign(target, { quantity: a.quantity, unit: a.unit || target.unit })
      else used.push({ name: a.name, quantity: a.quantity, unit: a.unit || 'unit' })
    }

    // Deduct from the soonest-expiring matches first
    const pantry = (await loadPantry(supabase, scope)).filter(p => Number(p.quantity) > 0)
    const touched = new Map()
    const unmatched = []
    const mismatched = []
    const short = []
    const noQty = []
    for (const u of used) {
      if (!u.quantity) { if (u.quantity === null) noQty.push(u.name); continue }
      const matches = matchPantry(u.name, pantry)
        .sort((a, b) => (a.expiry_date || '9999').localeCompare(b.expiry_date || '9999'))
      if (!matches.length) { unmatched.push(`${qtyLabel(u.quantity, u.unit)} ${u.name}`); continue }
      let remaining = u.quantity
      let convertible = false
      for (const p of matches) {
        const have = convert(Number(p.quantity), p.unit, u.unit)
        if (have === null) continue
        convertible = true
        if (have <= 0 || remaining <= EPSILON) continue
        const take = Math.min(have, remaining)
        if (!touched.has(p.id)) touched.set(p.id, { snapshot: { ...p }, item: p })
        p.quantity = round(Number(p.quantity) - convert(take, u.unit, p.unit))
        remaining -= take
      }
      if (!convertible) {
        mismatched.push(`${qtyLabel(u.quantity, u.unit)} ${u.name} (pantry: ${matches.map(p => `${qtyLabel(p.quantity, p.unit)} ${p.name}`).join(', ')})`)
      } else if (remaining > EPSILON) {
        short.push(`${u.name}: pantry ran out ${qtyLabel(remaining, u.unit)} short`)
      }
    }

    const deductions = [...touched.values()].map(({ snapshot, item }) => {
      const after = item.quantity <= EPSILON ? 0 : item.quantity
      return {
        id: item.id, name: item.name, unit: item.unit,
        before: Number(snapshot.quantity), after, used: round(Number(snapshot.quantity) - after),
        deleted: after === 0, snapshot,
      }
    })

    const lines = [`${dry_run ? 'Would deduct' : 'Deducted'} for ${recipe.name} (${round(cooked)} serving${cooked === 1 ? '' : 's'}):`]
    if (!deductions.length) lines.push('- nothing (no pantry matches)')
    for (const d of deductions) {
      const rest = d.deleted ? 'used up, removed' : `${qtyLabel(d.after, d.unit)} left`
      lines.push(`- ${d.name}: ${qtyLabel(d.used, d.unit)} (${rest})`)
    }
    if (unmatched.length) lines.push('', 'Not in the pantry, nothing deducted:', ...unmatched.map(s => `- ${s}`))
    if (mismatched.length) lines.push('', "Units didn't convert, nothing deducted (use update_pantry):", ...mismatched.map(s => `- ${s}`))
    if (short.length) lines.push('', ...short.map(s => `- ${s}`))
    if (noQty.length) lines.push('', `No quantity in the recipe, not deducted: ${noQty.join(', ')}`)
    const usedUp = deductions.filter(d => d.deleted).map(d => d.name)
    const low = deductions.filter(d => !d.deleted && d.after <= Number(d.snapshot.low_threshold ?? 0)).map(d => d.name)
    if (usedUp.length) lines.push('', `Used up: ${usedUp.join(', ')}`)
    if (low.length) lines.push(`Now low: ${low.join(', ')}`)
    if (log_nutrition && !recipe.nutrition) lines.push('', 'This recipe has no nutrition per serving, so nothing would be logged.')

    if (dry_run) {
      lines.push('', 'Dry run: nothing changed. Confirm with the user, then call again without dry_run.')
      return text(lines.join('\n'))
    }

    for (const d of deductions) {
      const { error } = d.deleted
        ? await supabase.from('inventory_items').delete().eq('id', d.id)
        : await supabase.from('inventory_items').update({ quantity: d.after, updated_at: new Date().toISOString() }).eq('id', d.id)
      if (error) return fail(`Stopped at ${d.name}: ${error.message}`)
    }

    let mealLogId = null
    if (log_nutrition && recipe.nutrition) {
      const n = recipe.nutrition
      const { data, error } = await supabase.from('meal_logs').insert({
        date: meal?.date || today,
        meal_type: meal_type || meal?.meal_type || 'dinner',
        food_name: recipe.name,
        calories: n.calories, protein_g: n.protein_g, carbs_g: n.carbs_g, fat_g: n.fat_g, fibre_g: n.fibre_g ?? null,
        servings: servings_eaten,
        source: 'recipe',
        meal_plan_id: meal?.id || null,
        created_by: user.id,
      }).select('id').single()
      if (error) lines.push('', `Nutrition not logged: ${error.message}`)
      else { mealLogId = data.id; lines.push('', `Logged ${servings_eaten} serving(s) of ${recipe.name} to nutrition.`) }
    }

    if (meal) {
      const { error } = await supabase.from('meal_plans').update({ cooked_at: new Date().toISOString() }).eq('id', meal.id)
      if (!error) lines.push(`Marked the planned ${meal.meal_type} on ${meal.date} as cooked.`)
    }

    const { data: log, error: logErr } = await supabase.from('cook_logs').insert({
      recipe_id: recipe.id, recipe_name: recipe.name, servings: cooked,
      meal_plan_id: meal?.id || null, meal_log_id: mealLogId,
      deductions: deductions.map(({ id, name, unit, used, deleted, snapshot }) => ({ id, name, unit, used, deleted, snapshot })),
      created_by: user.id, household_id: scope.householdId,
    }).select('id').single()
    lines.push('', logErr ? `Couldn't save an undo record: ${logErr.message}` : `Undo with undo_cook (cook id ${log.id}).`)
    return text(lines.join('\n'))
  })

  server.registerTool('undo_cook', {
    title: 'Undo cook',
    description: 'Put back the pantry quantities taken by cook_recipe. Defaults to the most recent cook.',
    inputSchema: { cook_id: z.string().uuid().optional() },
  }, async ({ cook_id }) => {
    let query = scope.filter(supabase.from('cook_logs').select('*')).is('undone_at', null)
    query = cook_id ? query.eq('id', cook_id) : query.order('created_at', { ascending: false }).limit(1)
    const { data: logs, error } = await query
    if (error) return fail(error.message)
    const log = logs[0]
    if (!log) return fail(cook_id ? 'No cook with that id, or it was already undone.' : 'Nothing to undo.')

    const restored = []
    for (const d of log.deductions) {
      const { data: current } = await supabase.from('inventory_items').select('id, quantity').eq('id', d.id).maybeSingle()
      const { error: err } = current
        ? await supabase.from('inventory_items')
          .update({ quantity: round(Number(current.quantity) + d.used), updated_at: new Date().toISOString() }).eq('id', d.id)
        : await supabase.from('inventory_items').insert({ ...d.snapshot, quantity: d.used })
      if (err) return fail(`Stopped at ${d.name}: ${err.message}`)
      restored.push(`${d.name}: +${qtyLabel(d.used, d.unit)}`)
    }
    if (log.meal_plan_id) await supabase.from('meal_plans').update({ cooked_at: null }).eq('id', log.meal_plan_id)
    if (log.meal_log_id) await supabase.from('meal_logs').delete().eq('id', log.meal_log_id)
    await supabase.from('cook_logs').update({ undone_at: new Date().toISOString() }).eq('id', log.id)

    const extra = [log.meal_plan_id && 'un-marked the planned meal', log.meal_log_id && 'removed the nutrition entry'].filter(Boolean)
    return text(`Undid cooking ${log.recipe_name}:\n${restored.map(s => `- ${s}`).join('\n') || '- nothing to put back'}` +
      (extra.length ? `\nAlso ${extra.join(' and ')}.` : ''))
  })

  // ── Nutrition ───────────────────────────────────────────────────
  server.registerTool('log_nutrition', {
    title: 'Log nutrition',
    description:
      'Log what the user ate. For a photo, estimate the foods and macros yourself, read them back for the user ' +
      'to confirm, then log with source=photo_estimate.',
    inputSchema: {
      date: z.string().regex(DATE_RE).optional().describe('YYYY-MM-DD, defaults to today'),
      meal_type: z.enum(MEAL_TYPES),
      description: z.string().min(1).max(200).describe('Shown as the entry name, e.g. "Chicken burrito bowl"'),
      items: z.array(z.object({
        name: z.string().min(1).max(120),
        estimated_quantity: z.number().min(0).optional(),
        unit: z.string().max(20).optional(),
        calories: z.number().min(0),
        protein_g: z.number().min(0),
        carbs_g: z.number().min(0),
        fat_g: z.number().min(0),
        fibre_g: z.number().min(0).optional(),
      })).min(1).max(30),
      source: z.enum(['photo_estimate', 'recipe', 'manual']),
      meal_id: z.string().uuid().optional().describe('Planned meal this was'),
      notes: z.string().max(500).optional(),
    },
  }, async ({ date = today, meal_type, description, items, source, meal_id, notes }) => {
    if (meal_id) {
      const { data } = await scope.filter(supabase.from('meal_plans').select('id').eq('id', meal_id)).maybeSingle()
      if (!data) return fail('No planned meal with that id. Call view_meal_plan.')
    }
    const sum = k => Math.round(items.reduce((t, i) => t + (i[k] || 0), 0) * 10) / 10
    const hasFibre = items.some(i => i.fibre_g != null)
    const row = {
      date, meal_type, food_name: description.trim(),
      calories: Math.round(sum('calories')), protein_g: sum('protein_g'), carbs_g: sum('carbs_g'), fat_g: sum('fat_g'),
      fibre_g: hasFibre ? sum('fibre_g') : null,
      servings: 1, notes: notes || null, source, items, meal_plan_id: meal_id || null, created_by: user.id,
    }
    const { data, error } = await supabase.from('meal_logs').insert(row).select('id').single()
    if (error) return fail(error.message)
    return text(`Logged ${meal_type} on ${date}: ${row.food_name}${source === 'photo_estimate' ? ' (estimate)' : ''}\n` +
      `${nutritionLine(row)}\nid: ${data.id}`)
  })

  server.registerTool('view_nutrition', {
    title: 'View nutrition',
    description: "Show logged food and macro totals against the user's targets for a day, or totals for several days.",
    inputSchema: {
      date: z.string().regex(DATE_RE).optional().describe('YYYY-MM-DD, defaults to today'),
      days: z.number().int().min(1).max(14).optional().describe('Days from date, defaults to 1. Use 7 for a week'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ date = today, days = 1 }) => {
    const end = new Date(date + 'T12:00:00Z')
    end.setUTCDate(end.getUTCDate() + days - 1)
    const to = end.toISOString().slice(0, 10)
    const { data: logs, error } = await supabase.from('meal_logs').select('*')
      .eq('created_by', user.id).gte('date', date).lte('date', to).order('date').order('created_at')
    if (error) return fail(error.message)
    const { data: profile } = await supabase.from('user_profiles')
      .select('calorie_goal, protein_goal, carbs_goal, fat_goal').eq('id', user.id).maybeSingle()
    const goals = {
      calories: profile?.calorie_goal ?? DEFAULT_GOALS.calories,
      protein_g: profile?.protein_goal ?? DEFAULT_GOALS.protein,
      carbs_g: profile?.carbs_goal ?? DEFAULT_GOALS.carbs,
      fat_g: profile?.fat_goal ?? DEFAULT_GOALS.fat,
    }
    const total = rows => Object.fromEntries(['calories', 'protein_g', 'carbs_g', 'fat_g', 'fibre_g']
      .map(k => [k, Math.round(rows.reduce((t, l) => t + (Number(l[k]) || 0) * (Number(l.servings) || 1), 0))]))
    const vsGoal = t => `${t.calories}/${goals.calories} kcal, protein ${t.protein_g}/${goals.protein_g} g, ` +
      `carbs ${t.carbs_g}/${goals.carbs_g} g, fat ${t.fat_g}/${goals.fat_g} g${t.fibre_g ? `, fibre ${t.fibre_g} g` : ''}`

    const lines = []
    if (days === 1) {
      lines.push(`${date}${date === today ? ' (today)' : ''}: ${vsGoal(total(logs))}`)
      if (!logs.length) lines.push('Nothing logged.')
      for (const t of MEAL_TYPES) {
        for (const l of logs.filter(x => x.meal_type === t)) {
          const s = Number(l.servings) || 1
          const est = l.source === 'photo_estimate' ? ' [estimate]' : ''
          lines.push(`- ${t}: ${l.food_name}${s !== 1 ? ` × ${s}` : ''}${est}: ${Math.round(l.calories * s)} kcal, ` +
            `P ${Math.round(l.protein_g * s)} g, C ${Math.round(l.carbs_g * s)} g, F ${Math.round(l.fat_g * s)} g\n  id: ${l.id}`)
        }
      }
    } else {
      const all = total(logs)
      for (let d = new Date(date + 'T12:00:00Z'); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        const day = d.toISOString().slice(0, 10)
        const rows = logs.filter(l => l.date === day)
        lines.push(`${day}: ${rows.length ? vsGoal(total(rows)) : 'nothing logged'}`)
      }
      const logged = new Set(logs.map(l => l.date)).size
      if (logged) {
        const avg = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, Math.round(v / logged)]))
        lines.push('', `Daily average over ${logged} logged day(s): ${vsGoal(avg)}`)
      }
    }
    return text(lines.join('\n'))
  })
}
