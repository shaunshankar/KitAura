import { serviceClient, newKey, setKeyHash } from './_connector.js'

// Manage the Claude connector link for the signed-in user.
// Requests carry the Supabase session: `Authorization: Bearer <access token>`.
// GET    /api/mcp-key — { connected }
// POST   /api/mcp-key — { key } shown once; replaces any previous link
// DELETE /api/mcp-key — disconnect
export default async function handler(req, res) {
  const supabase = serviceClient()
  if (!supabase) return res.status(500).json({ error: 'Connector not configured' })

  const token = (req.headers.authorization || '').replace(/^Bearer /, '')
  const { data, error } = token ? await supabase.auth.getUser(token) : { data: null }
  const user = data?.user
  if (error || !user) return res.status(401).json({ error: 'Unauthorised' })

  if (req.method === 'GET') {
    return res.status(200).json({ connected: !!user.app_metadata?.mcp_key_hash })
  }
  if (req.method === 'POST') {
    const { key, hash } = newKey(user.id)
    await setKeyHash(supabase, user, hash)
    return res.status(200).json({ key })
  }
  if (req.method === 'DELETE') {
    await setKeyHash(supabase, user, null)
    return res.status(200).json({ connected: false })
  }
  return res.status(405).json({ error: 'Method not allowed' })
}
