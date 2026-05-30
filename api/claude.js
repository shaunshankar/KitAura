export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed')
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'API key not configured on server' } })
  }

  const extraHeaders = req.headers['x-anthropic-beta']
    ? { 'anthropic-beta': req.headers['x-anthropic-beta'] }
    : {}

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      ...extraHeaders,
    },
    body: JSON.stringify(req.body),
  })

  const responseBody = await upstream.text()
  res.status(upstream.status).setHeader('Content-Type', 'application/json').send(responseBody)
}
