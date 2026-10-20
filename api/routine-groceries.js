import { routineContext } from './_routine.js'

// GET /api/routine-groceries — items still to buy on the shopping list
export default async function handler(req, res) {
  const ctx = await routineContext(req, res)
  if (!ctx) return

  const { data, error } = await ctx.supabase
    .from('shopping_list_items')
    .select('name, quantity, unit, category')
    .eq('is_purchased', false)
    .or(ctx.owner)
    .order('category')
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ count: data.length, items: data })
}
