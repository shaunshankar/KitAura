import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes, timingSafeEqual } from 'crypto'

// Shared by /api/mcp (Claude) and /api/mcp-key (Settings → Connect Claude).
// A connector key looks like `<user id>.<secret>`. Only a SHA-256 of the secret is
// kept, in the user's Supabase app_metadata, so no table or migration is needed.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function serviceClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

const sha256 = s => createHash('sha256').update(s).digest('hex')

export function newKey(userId) {
  const secret = randomBytes(32).toString('base64url')
  return { key: `${userId}.${secret}`, hash: sha256(secret) }
}

// Returns the Supabase user the key belongs to, or null
export async function userForKey(supabase, key) {
  const [userId, secret] = String(key || '').split('.')
  if (!UUID_RE.test(userId || '') || !secret || secret.length < 32) return null
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  const stored = data?.user?.app_metadata?.mcp_key_hash
  if (error || !stored) return null
  const given = Buffer.from(sha256(secret))
  return timingSafeEqual(given, Buffer.from(stored)) ? data.user : null
}

export async function setKeyHash(supabase, user, hash) {
  const { error } = await supabase.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, mcp_key_hash: hash },
  })
  if (error) throw error
}

// Same scoping as the app's own pages: the household's rows, or the user's own
export async function scopeFor(supabase, userId) {
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('household_id')
    .eq('id', userId)
    .maybeSingle()
  const householdId = profile?.household_id || null
  return {
    householdId,
    filter: query => (householdId ? query.eq('household_id', householdId) : query.eq('created_by', userId)),
  }
}
