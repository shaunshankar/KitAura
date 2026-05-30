export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: 'API key not configured on server' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const body = await req.text()
  const extraHeaders = req.headers.get('x-anthropic-beta')
    ? { 'anthropic-beta': req.headers.get('x-anthropic-beta') }
    : {}

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...extraHeaders,
    },
    body,
  })

  const responseBody = await upstream.text()
  return new Response(responseBody, {
    status: upstream.status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export const config = { path: '/api/claude', timeout: 26 }
