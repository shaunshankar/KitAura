import nodemailer from 'nodemailer'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed')
  }

  const { to, subject, text, html } = req.body

  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, and text or html' })
  }

  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD

  if (!user || !pass) {
    return res.status(500).json({ error: 'Email credentials not configured on server' })
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  })

  try {
    await transporter.sendMail({
      from: `KitAura <${user}>`,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject,
      text,
      html,
    })
    res.status(200).json({ success: true })
  } catch (err) {
    console.error('send-email error:', err)
    res.status(500).json({ error: err.message })
  }
}
