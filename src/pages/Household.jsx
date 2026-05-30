import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { Users } from 'lucide-react'
import Modal from '../components/Modal'
import './Household.css'

function generateInviteCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function Household({ user }) {
  const [profile, setProfile] = useState(null)
  const [household, setHousehold] = useState(null)
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [createForm, setCreateForm] = useState({ name: '', description: '' })
  const [joinCode, setJoinCode] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => { loadAll() }, [user])

  async function loadAll() {
    setLoading(true)
    const { data: prof } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single()
    setProfile(prof)

    if (prof?.household_id) {
      const { data: hh } = await supabase
        .from('households')
        .select('*')
        .eq('id', prof.household_id)
        .single()
      setHousehold(hh)

      const { data: mems } = await supabase
        .from('household_members')
        .select('*')
        .eq('household_id', prof.household_id)
        .order('created_at')
      setMembers(mems || [])
    } else {
      setHousehold(null)
      setMembers([])
    }
    setLoading(false)
  }

  async function handleCreate() {
    if (!createForm.name.trim()) { setError('Household name is required'); return }
    setSaving(true)
    setError('')
    const invite_code = generateInviteCode()

    const { data: hh, error: hhErr } = await supabase
      .from('households')
      .insert({ name: createForm.name.trim(), description: createForm.description || null, invite_code, created_by: user.id })
      .select()
      .single()

    if (hhErr) { setError(hhErr.message); setSaving(false); return }

    // Add creator as owner member
    await supabase.from('household_members').insert({
      household_id: hh.id,
      user_email: user.email,
      user_name: profile?.name || user.email?.split('@')[0],
      role: 'owner',
      created_by: user.id,
    })

    // Update profile
    await supabase.from('user_profiles').update({ household_id: hh.id }).eq('id', user.id)

    // Migrate all existing data into the new household (regardless of prior household_id)
    const tables = ['inventory_items', 'shopping_list_items', 'meal_plans', 'grocery_spend', 'recipes']
    await Promise.all(
      tables.map(t =>
        supabase.from(t).update({ household_id: hh.id }).eq('created_by', user.id)
      )
    )

    setSaving(false)
    setShowCreateModal(false)
    setCreateForm({ name: '', description: '' })
    loadAll()
  }

  async function handleJoin() {
    const code = joinCode.trim().toUpperCase()
    if (!code) { setError('Enter an invite code'); return }
    setSaving(true)
    setError('')

    const { data: hh } = await supabase
      .from('households')
      .select('*')
      .eq('invite_code', code)
      .single()

    if (!hh) { setError('Invalid invite code. Check and try again.'); setSaving(false); return }

    // Check not already a member
    const { data: existing } = await supabase
      .from('household_members')
      .select('id')
      .eq('household_id', hh.id)
      .eq('user_email', user.email)
      .single()

    if (existing) { setError('You are already a member of this household.'); setSaving(false); return }

    await supabase.from('household_members').insert({
      household_id: hh.id,
      user_email: user.email,
      user_name: profile?.name || user.email?.split('@')[0],
      role: 'member',
      created_by: user.id,
    })

    await supabase.from('user_profiles').update({ household_id: hh.id }).eq('id', user.id)

    setSaving(false)
    setShowJoinModal(false)
    setJoinCode('')
    loadAll()
  }

  async function handleLeave() {
    if (!confirm('Leave this household? You will lose access to shared data.')) return
    setSaving(true)

    await supabase.from('household_members')
      .delete()
      .eq('household_id', household.id)
      .eq('user_email', user.email)

    await supabase.from('user_profiles').update({ household_id: null }).eq('id', user.id)

    setSaving(false)
    loadAll()
  }

  async function copyInviteCode() {
    if (!household?.invite_code) return
    await navigator.clipboard.writeText(household.invite_code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading) {
    return <div className="loading-state"><span className="spinner" /> Loading…</div>
  }

  const isOwner = household?.created_by === user.id

  return (
    <div className="household-page">
      {!household ? (
        <div className="household-setup-centred">
          <div className="household-setup-card card">
            <div className="household-setup-icon">
              <Users size={48} color="var(--accent-light)" strokeWidth={1.5} />
            </div>
            <h2>Set Up Your Household</h2>
            <p>Share your inventory, shopping list, and meal plans with your family or housemates. Create a household to get started, or join one with an invite code.</p>
            <div className="household-setup-actions">
              <button className="btn btn-primary" onClick={() => { setError(''); setShowCreateModal(true) }}>
                + Create Household
              </button>
              <button className="btn btn-ghost" onClick={() => { setError(''); setShowJoinModal(true) }}>
                🔑 Join with Code
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
        <div className="page-header"><h1>Household</h1></div>
        <div className="household-content">
          {/* Household info */}
          <div className="card household-info-card">
            <div className="household-info-header">
              <div>
                <h2 className="household-name">{household.name}</h2>
                {household.description && (
                  <p className="household-description">{household.description}</p>
                )}
              </div>
              {isOwner && <span className="badge badge-accent">Owner</span>}
            </div>

            <div className="invite-code-section">
              <div className="invite-code-label">Invite Code</div>
              <div className="invite-code-box">
                <span className="invite-code">{household.invite_code}</span>
                <button className="btn btn-ghost btn-sm" onClick={copyInviteCode}>
                  {copied ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              <p className="invite-code-hint">Share this code with people you want to invite to your household.</p>
            </div>
          </div>

          {/* Members */}
          <div className="household-section">
            <h3 className="household-section-title">Members ({members.length})</h3>
            <div className="members-list">
              {members.map(member => (
                <div key={member.id} className="member-item card">
                  <div className="member-avatar">
                    {(member.user_name || member.user_email || '?')[0].toUpperCase()}
                  </div>
                  <div className="member-info">
                    <span className="member-name">{member.user_name || 'Member'}</span>
                    <span className="member-email">{member.user_email}</span>
                  </div>
                  <span className={'badge ' + (member.role === 'owner' ? 'badge-accent' : 'badge-neutral')}>
                    {member.role}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Leave */}
          <div className="household-section">
            <button className="btn btn-danger" onClick={handleLeave} disabled={saving}>
              {saving ? <span className="spinner" /> : null}
              Leave Household
            </button>
          </div>
        </div>
        </>
      )}

      {/* Create modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create Household">
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>Household Name</label>
          <input
            value={createForm.name}
            onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. The Smiths"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label>Description (optional)</label>
          <input
            value={createForm.description}
            onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
            placeholder="e.g. Our family home"
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setShowCreateModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            Create Household
          </button>
        </div>
      </Modal>

      {/* Join modal */}
      <Modal isOpen={showJoinModal} onClose={() => setShowJoinModal(false)} title="Join Household">
        {error && <div className="error-msg">{error}</div>}
        <div className="form-group">
          <label>Invite Code</label>
          <input
            value={joinCode}
            onChange={e => setJoinCode(e.target.value.toUpperCase())}
            placeholder="e.g. ABCD1234"
            maxLength={8}
            autoFocus
            style={{ textTransform: 'uppercase', letterSpacing: '0.1em', fontSize: '1.1rem' }}
          />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={() => setShowJoinModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={handleJoin} disabled={saving}>
            {saving ? <span className="spinner" /> : null}
            Join Household
          </button>
        </div>
      </Modal>
    </div>
  )
}
