import { routineContext } from './_routine.js'

// GET /api/routine-meals?date=YYYY-MM-DD — meal plan for one day
export default async function handler(req, res) {
  const ctx = await routineContext(req, res)
  if (!ctx) return

  const { date } = req.query
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' })
  }

  const { data, error } = await ctx.supabase
    .from('meal_plans')
    .select('meal_type, recipe_name, notes, servings')
    .eq('date', date)
    .or(ctx.owner)
    .order('meal_type')
  if (error) return res.status(500).json({ error: error.message })

  return res.status(200).json({ date, meals: data })
}
