import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { serviceClient, userForKey, scopeFor } from './_connector.js'

// MCP endpoint for Claude: https://<kitora>/api/mcp?key=<link from Settings → Connect Claude>
// Stateless Streamable HTTP: every POST builds a fresh server scoped to the key's user.

const TIMEZONE = process.env.KITORA_TIMEZONE || 'Australia/Sydney'

// Same lists as the Shopping List page
const CATEGORIES = [
  'produce', 'dairy', 'meat', 'grains', 'canned', 'frozen',
  'beverages', 'snacks', 'condiments', 'bakery',
  'household', 'personal care', 'other',
]
const UNITS = ['unit', 'g', 'kg', 'ml', 'L', 'oz', 'lb', 'cup', 'tbsp', 'tsp', 'pack', 'bunch', 'can', 'bottle', 'box']
const MEAL_ORDER = ['breakfast', 'lunch', 'dinner', 'snack']

const text = s => ({ content: [{ type: 'text', text: s }] })
const fail = s => ({ content: [{ type: 'text', text: s }], isError: true })

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

function buildServer(supabase, user, scope, today) {
  const server = new McpServer(
    { name: 'kitora', version: '1.0.0' },
    {
      instructions:
        `Kitora: the user's shopping list and meal plan. Today is ${today} (${TIMEZONE}). ` +
        'Convert relative days like "tomorrow" to YYYY-MM-DD. Add each grocery as its own item with a sensible category. ' +
        'Use view_shopping_list to find ids before ticking items off.',
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
    description: 'Mark items as bought, or un-tick them with bought=false.',
    inputSchema: {
      ids: z.array(z.string().uuid()).min(1).max(100).describe('From view_shopping_list'),
      bought: z.boolean().optional().describe('Defaults to true'),
    },
  }, async ({ ids, bought = true }) => {
    const { data, error } = await scope.filter(supabase.from('shopping_list_items')
      .update({ is_purchased: bought }).in('id', ids)).select('name')
    if (error) return fail(error.message)
    if (!data.length) return fail('No matching items. Call view_shopping_list to get current ids.')
    return text(`${bought ? 'Ticked off' : 'Un-ticked'}: ${data.map(i => i.name).join(', ')}`)
  })

  server.registerTool('view_meal_plan', {
    title: 'View meal plan',
    description: 'Show planned meals for a day (default today), or several days from that date.',
    inputSchema: {
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD, defaults to today'),
      days: z.number().int().min(1).max(14).optional().describe('How many days to show, defaults to 1'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ date = today, days = 1 }) => {
    const to = addDays(date, days - 1)
    const { data, error } = await scope.filter(supabase.from('meal_plans')
      .select('date, meal_type, recipe_name, notes, servings'))
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
        lines.push(`  ${m.meal_type || 'meal'}: ${m.recipe_name}${serves}${m.notes ? ` (${m.notes})` : ''}`)
      }
    }
    return text(lines.join('\n'))
  })

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
