import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

async function call(method) {
  const { data } = await supabase.auth.getSession()
  const res = await fetch('/api/mcp-key', {
    method,
    headers: { Authorization: `Bearer ${data.session?.access_token || ''}` },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Something went wrong')
  return body
}

// Settings → Connect Claude: makes the secret connector link for Claude's custom connectors
export default function ClaudeConnect() {
  const [connected, setConnected] = useState(null)
  const [link, setLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    call('GET').then(r => setConnected(r.connected)).catch(err => setError(err.message))
  }, [])

  async function create() {
    setBusy(true)
    setError('')
    try {
      const { key } = await call('POST')
      setLink(`${window.location.origin}/api/mcp?key=${key}`)
      setConnected(true)
      setCopied(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    setError('')
    try {
      await call('DELETE')
      setConnected(false)
      setLink('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section className="settings-section card">
      <h2 className="settings-section-title">Connect Claude</h2>
      <p className="settings-section-desc">
        Let Claude add to your shopping list, tick items off and read your meal plan, e.g. &ldquo;add milk to my shopping list&rdquo;.
      </p>
      {error && <div className="error-msg">{error}</div>}

      {link ? (
        <>
          <div className="form-group">
            <label>Your connector link</label>
            <input value={link} readOnly onFocus={e => e.target.select()} />
            <span className="form-hint">Shown once. Anyone with this link can edit your list, so keep it private.</span>
          </div>
          <ol className="connect-steps">
            <li>In Claude, open <strong>Settings → Connectors → Add custom connector</strong>.</li>
            <li>Name it <strong>Kitora</strong> and paste the link.</li>
            <li>Turn it on in a chat and ask away.</li>
          </ol>
          <div className="connect-actions">
            <button className="btn btn-primary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
            <button className="btn btn-ghost" onClick={() => setLink('')}>Done</button>
          </div>
        </>
      ) : connected ? (
        <>
          <p className="form-hint">Claude is connected. Making a new link stops the old one working.</p>
          <div className="connect-actions">
            <button className="btn btn-ghost" onClick={create} disabled={busy}>Make a new link</button>
            <button className="btn btn-ghost" onClick={disconnect} disabled={busy}>Disconnect</button>
          </div>
        </>
      ) : (
        <div className="connect-actions">
          <button className="btn btn-primary" onClick={create} disabled={busy || connected === null}>
            {busy ? <span className="spinner" /> : null}
            Create connector link
          </button>
        </div>
      )}
    </section>
  )
}
