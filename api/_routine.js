import { createClient } from '@supabase/supabase-js'

// Shared by the read-only routes the Daily Routine app calls.
// Requests must send `x-api-key: <ROUTINE_API_KEY>`. Data is scoped to the
// Kitora user with email ROUTINE_USER_EMAIL (their own rows plus their household's).
export async function routineContext(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return null
  }

  const { ROUTINE_API_KEY, ROUTINE_USER_EMAIL, SUPABASE_SERVICE_ROLE_KEY } = process.env
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  if (!ROUTINE_API_KEY || !ROUTINE_USER_EMAIL || !SUPABASE_SERVICE_ROLE_KEY || !url) {
    res.status(500).json({ error: 'Routine API not configured' })
    return null
  }
  if (req.headers['x-api-key'] !== ROUTINE_API_KEY) {
    res.status(401).json({ error: 'Unauthorised' })
    return null
  }

  const supabase = createClient(url, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('id, household_id')
    .eq('email', ROUTINE_USER_EMAIL.toLowerCase())
    .maybeSingle()
  if (error || !profile) {
    res.status(404).json({ error: 'Routine user not found' })
    return null
  }

  const owner = profile.household_id
    ? `created_by.eq.${profile.id},household_id.eq.${profile.household_id}`
    : `created_by.eq.${profile.id}`
  return { supabase, owner }
}
