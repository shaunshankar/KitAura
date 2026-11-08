import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { serviceClient, userForKey, scopeFor } from './_connector.js'
import { text, fail, SHOPPING_CATEGORIES as CATEGORIES, UNITS, MEAL_TYPES as MEAL_ORDER, DATE_RE } from './_kitchen.js'
import { registerKitchenTools, addToPantry, loadPantry } from './_mcp-kitchen.js'

// MCP endpoint for Claude: https://<kitora>/api/mcp?key=<link from Settings → Connect Claude>
// Stateless Streamable HTTP: every POST builds a fresh server scoped to the key's user.

const TIMEZONE = process.env.KITORA_TIMEZONE || 'Australia/Sydney'

function todayIn(tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function itemLine(i) {
  const qty = i.unit && i.unit !== 'unit' ? `${i.quantity} ${i.unit} ` : Number(i.quantity) > 1 ? `${i.quantity} × ` : ''
  const bits = [i.category || 'other', i.is_purchased && 'bought'].filter(Boolean)
  return `- ${qty}${i.name} (${bits.join(', ')})${i.description ? `\n  note: ${i.description}` : ''}\n  id: ${i.id}`
}

export function buildServer(supabase, user, scope, today) {
  const server = new McpServer(
    { name: 'kitora', version: '2.0.0' },
    {
      instructions:
        `Kitora: the user's shopping list, meal plan, recipes, pantry and nutrition log. Today is ${today} (${TIMEZONE}). ` +
        'Convert relative days like "tomorrow" to YYYY-MM-DD. Add each grocery as its own item with a sensible category. ' +
        'Use the view/list tools to find ids before changing anything. ' +
        '"Do we have the ingredients for X?": find X with list_recipes (or write and save_recipe it), call ' +
        'check_recipe_ingredients, tell the user what is missing or low, and only add those to the shopping list once they agree. ' +
        '"We cooked X": call cook_recipe with dry_run=true, read the deductions back, apply them once the user confirms, ' +
        'then offer to add used-up or low items to the shopping list. undo_cook reverses a mistake. ' +
        'Meal photos: estimate foods and macros, read them back for the user to confirm, then log_nutrition with source=photo_estimate.',
    }
  )

  server.registerTool('view_shopping_list', {
    title: 'View shopping list',
    description: 'Show the shopping list. By default only items still to buy.',
    inputSchema: { include_bought: z.boolean().optional().describe('Also show items already ticked off') },
    annotations: { readOnlyHint: true },
  }, async ({ include_bought = false }) => {
    let query = scope.filter(supabase.from('shopping_list_items')
      .select('id, name, quantity, unit, category, description, is_purchased'))
    if (!include_bought) query = query.eq('is_purchased', false)
    const { data, error } = await query.order('category').order('name')
    if (error) return fail(error.message)
    if (!data.length) return text(include_bought ? 'The shopping list is empty.' : 'Nothing left to buy.')
    return text(`${data.length} item${data.length === 1 ? '' : 's'}:\n${data.map(itemLine).join('\n')}`)
  })

  server.registerTool('add_shopping_items', {
    title: 'Add to shopping list',
    description: 'Add one or more items to the shopping list. Items already on the list (not yet bought) are skipped.',
    inputSchema: {
      items: z.array(z.object({
        name: z.string().min(1).max(120),
        quantity: z.number().positive().optional().describe('Defaults to 1'),
        unit: z.enum(UNITS).optional().describe('Defaults to unit'),
        category: z.enum(CATEGORIES).optional().describe('Defaults to other'),
        note: z.string().max(500).optional().describe('Brand, size or other detail'),
      })).min(1).max(50),
    },
  }, async ({ items }) => {
    const { data: open, error: readErr } = await scope.filter(supabase.from('shopping_list_items')
      .select('name').eq('is_purchased', false))
    if (readErr) return fail(readErr.message)
    const have = new Set(open.map(i => i.name.trim().toLowerCase()))
    const skipped = []
    const rows = []
    for (const i of items) {
      const key = i.name.trim().toLowerCase()
      if (have.has(key)) { skipped.push(i.name); continue }
      have.add(key)
      rows.push({
        name: i.name.trim(),
        quantity: i.quantity ?? 1,
        unit: i.unit || 'unit',
        category: i.category || 'other',
        description: i.note || null,
        created_by: user.id,
        household_id: scope.householdId,
      })
    }
    let added = []
    if (rows.length) {
      const { data, error } = await supabase.from('shopping_list_items')
        .insert(rows).select('id, name, quantity, unit, category, description, is_purchased')
      if (error) return fail(error.message)
      added = data
    }
    const parts = []
    if (added.length) parts.push(`Added ${added.length}:\n${added.map(itemLine).join('\n')}`)
    if (skipped.length) parts.push(`Already on the list: ${skipped.join(', ')}`)
    return text(parts.join('\n'))
  })

  server.registerTool('tick_shopping_items', {
    title: 'Tick off shopping items',
    description: 'Mark items as bought, or un-tick them with bought=false. to_pantry also adds bought food to the pantry.',
    inputSchema: {
      ids: z.array(z.string().uuid()).min(1).max(100).describe('From view_shopping_list'),
      bought: z.boolean().optional().describe('Defaults to true'),
      to_pantry: z.boolean().optional().describe('Add the bought items to the pantry (household and personal care items are skipped)'),
    },
  }, async ({ ids, bought = true, to_pantry = false }) => {
    const { data, error } = await scope.filter(supabase.from('shopping_list_items')
      .update({ is_purchased: bought }).in('id', ids)).select('name, quantity, unit, category')
    if (error) return fail(error.message)
    if (!data.length) return fail('No matching items. Call view_shopping_list to get current ids.')
    const lines = [`${bought ? 'Ticked off' : 'Un-ticked'}: ${data.map(i => i.name).join(', ')}`]
    if (bought && to_pantry) {
      const pantry = await loadPantry(supabase, scope)
      const food = data.filter(i => !['household', 'personal care'].includes(i.category))
      for (const i of food) {
        try {
          lines.push(`- pantry ${await addToPantry(supabase, user, scope, pantry, { ...i, quantity: Number(i.quantity) || 1 })}`)
        } catch (err) {
          lines.push(`- pantry: couldn't add ${i.name}: ${err.message}`)
        }
      }
    }
    return text(lines.join('\n'))
  })

  server.registerTool('update_shopping_item', {
    title: 'Edit shopping item',
    description: 'Change the name, quantity, unit, note or category of a shopping list item.',
    inputSchema: {
      id: z.string().uuid().describe('From view_shopping_list'),
      name: z.string().min(1).max(120).optional(),
      quantity: z.number().positive().optional(),
      unit: z.enum(UNITS).optional(),
      category: z.enum(CATEGORIES).optional(),
      note: z.string().max(500).nullable().optional().describe('null clears it'),
    },
  }, async ({ id, note, ...fields }) => {
    const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    if (note !== undefined) patch.description = note
    if (patch.name) patch.name = patch.name.trim()
    if (!Object.keys(patch).length) return fail('Nothing to change.')
    const { data, error } = await scope.filter(supabase.from('shopping_list_items').update(patch).eq('id', id))
      .select('id, name, quantity, unit, category, description, is_purchased').maybeSingle()
    if (error) return fail(error.message)
    if (!data) return fail('No matching item. Call view_shopping_list to get current ids.')
    return text(`Updated:\n${itemLine(data)}`)
  })

  server.registerTool('remove_shopping_items', {
    title: 'Remove shopping items',
    description: 'Delete items from the shopping list.',
    inputSchema: { ids: z.array(z.string().uuid()).min(1).max(100).describe('From view_shopping_list') },
    annotations: { destructiveHint: true },
  }, async ({ ids }) => {
    const { data, error } = await scope.filter(supabase.from('shopping_list_items').delete().in('id', ids)).select('name')
    if (error) return fail(error.message)
    if (!data.length) return fail('No matching items. Call view_shopping_list to get current ids.')
    return text(`Removed: ${data.map(i => i.name).join(', ')}`)
  })

  server.registerTool('view_meal_plan', {
    title: 'View meal plan',
    description: 'Show planned meals for a day (default today), or several days from that date.',
    inputSchema: {
      date: z.string().regex(DATE_RE).optional().describe('YYYY-MM-DD, defaults to today'),
      days: z.number().int().min(1).max(14).optional().describe('How many days to show, defaults to 1'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ date = today, days = 1 }) => {
    const to = addDays(date, days - 1)
    const { data, error } = await scope.filter(supabase.from('meal_plans')
      .select('id, date, meal_type, recipe_name, recipe_id, notes, servings, cooked_at'))
      .gte('date', date).lte('date', to).order('date')
    if (error) return fail(error.message)
    const lines = []
    for (let d = date; d <= to; d = addDays(d, 1)) {
      const meals = data.filter(m => m.date === d)
        .sort((a, b) => MEAL_ORDER.indexOf(a.meal_type) - MEAL_ORDER.indexOf(b.meal_type))
      const label = d === today ? `${d} (today)` : d === addDays(today, 1) ? `${d} (tomorrow)` : d
      lines.push(`${label}:`)
      if (!meals.length) lines.push('  nothing planned')
      for (const m of meals) {
        const serves = Number(m.servings) > 1 ? `, serves ${m.servings}` : ''
        const extra = [m.cooked_at && 'cooked', m.recipe_id && `recipe ${m.recipe_id}`].filter(Boolean)
        lines.push(`  ${m.meal_type || 'meal'}: ${m.recipe_name}${serves}${m.notes ? ` (${m.notes})` : ''}` +
          `${extra.length ? ` [${extra.join(', ')}]` : ''}\n    id: ${m.id}`)
      }
    }
    return text(lines.join('\n'))
  })

  const mealFields = {
    date: z.string().regex(DATE_RE).describe('YYYY-MM-DD'),
    meal_type: z.enum(MEAL_ORDER),
    title: z.string().min(1).max(150).describe("Defaults to the recipe's name when recipe_id is given"),
    recipe_id: z.string().uuid().nullable().describe('Saved recipe, from list_recipes'),
    servings: z.number().positive().max(50),
    note: z.string().max(500).nullable(),
  }

  // Turns tool fields into meal_plans columns, checking the recipe belongs to the user
  async function mealRow(fields) {
    const row = {}
    if (fields.date !== undefined) row.date = fields.date
    if (fields.meal_type !== undefined) row.meal_type = fields.meal_type
    if (fields.servings !== undefined) row.servings = fields.servings
    if (fields.note !== undefined) row.notes = fields.note
    if (fields.title !== undefined) row.recipe_name = fields.title.trim()
    if (fields.recipe_id !== undefined) {
      row.recipe_id = fields.recipe_id
      if (fields.recipe_id) {
        const { data } = await scope.filter(supabase.from('recipes').select('name').eq('id', fields.recipe_id)).maybeSingle()
        if (!data) throw new Error('No recipe with that id. Call list_recipes.')
        if (!row.recipe_name) row.recipe_name = data.name
      }
    }
    return row
  }

  const mealLine = m => `${m.date} ${m.meal_type}: ${m.recipe_name}${Number(m.servings) > 1 ? `, serves ${m.servings}` : ''}` +
    `${m.notes ? ` (${m.notes})` : ''}\nid: ${m.id}`

  server.registerTool('add_meal', {
    title: 'Add meal',
    description: 'Put a meal on the plan. Give a title, a saved recipe_id, or both.',
    inputSchema: {
      ...mealFields,
      title: mealFields.title.optional(),
      recipe_id: mealFields.recipe_id.optional(),
      servings: mealFields.servings.optional().describe('Defaults to 1'),
      note: mealFields.note.optional(),
    },
  }, async fields => {
    if (!fields.title && !fields.recipe_id) return fail('Give a title or a recipe_id.')
    let row
    try { row = await mealRow(fields) } catch (err) { return fail(err.message) }
    const { data, error } = await supabase.from('meal_plans')
      .insert({ servings: 1, ...row, created_by: user.id, household_id: scope.householdId })
      .select('*').single()
    if (error) return fail(error.message)
    return text(`Added:\n${mealLine(data)}`)
  })

  server.registerTool('update_meal', {
    title: 'Edit meal',
    description: 'Change a planned meal: move it, rename it, link a recipe, or change servings or the note.',
    inputSchema: {
      id: z.string().uuid().describe('From view_meal_plan'),
      ...Object.fromEntries(Object.entries(mealFields).map(([k, v]) => [k, v.optional()])),
    },
  }, async ({ id, ...fields }) => {
    let row
    try { row = await mealRow(fields) } catch (err) { return fail(err.message) }
    if (!Object.keys(row).length) return fail('Nothing to change.')
    const { data, error } = await scope.filter(supabase.from('meal_plans').update(row).eq('id', id)).select('*').maybeSingle()
    if (error) return fail(error.message)
    if (!data) return fail('No planned meal with that id. Call view_meal_plan.')
    return text(`Updated:\n${mealLine(data)}`)
  })

  server.registerTool('remove_meal', {
    title: 'Remove meal',
    description: 'Take a meal off the plan.',
    inputSchema: { id: z.string().uuid().describe('From view_meal_plan') },
    annotations: { destructiveHint: true },
  }, async ({ id }) => {
    const { data, error } = await scope.filter(supabase.from('meal_plans').delete().eq('id', id)).select('*').maybeSingle()
    if (error) return fail(error.message)
    if (!data) return fail('No planned meal with that id. Call view_meal_plan.')
    return text(`Removed ${data.recipe_name} (${data.date} ${data.meal_type}).`)
  })

  registerKitchenTools(server, supabase, user, scope, today)

  return server
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // Stateless server: no SSE stream or sessions to resume
  if (req.method !== 'POST') {
    return res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
  }

  const supabase = serviceClient()
  if (!supabase) {
    return res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Connector not configured' }, id: null })
  }
  const user = await userForKey(supabase, req.query.key)
  if (!user) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Invalid or missing connector key' }, id: null })
  }

  const scope = await scopeFor(supabase, user.id)
  const server = buildServer(supabase, user, scope, todayIn(TIMEZONE))
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    transport.close()
    server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}
