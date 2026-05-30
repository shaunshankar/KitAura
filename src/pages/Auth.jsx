import { useState } from 'react'
import { supabase } from '../lib/supabase'
import './Auth.css'

export default function Auth() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setSuccess('Check your email to confirm your account.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">
          <span className="auth-logo-icon">🌿</span>
          <h1>KitAura</h1>
          <p>Smart kitchen management</p>
        </div>

        <div className="tabs auth-tabs">
          <button
            className={'tab-btn' + (mode === 'signin' ? ' active' : '')}
            onClick={() => { setMode('signin'); setError(''); setSuccess('') }}
          >
            Sign In
          </button>
          <button
            className={'tab-btn' + (mode === 'signup' ? ' active' : '')}
            onClick={() => { setMode('signup'); setError(''); setSuccess('') }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="error-msg">{error}</div>}
          {success && <div className="success-msg">{success}</div>}

          <div className="form-group">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'signup' ? 'Min. 6 characters' : '••••••••'}
              required
              minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          <button type="submit" className="btn btn-primary auth-submit" disabled={loading}>
            {loading ? <span className="spinner" /> : null}
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
      </div>
    </div>
  )
}
