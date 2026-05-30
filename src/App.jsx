import { useState, useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import { supabase } from './lib/supabase'
import Sidebar from './components/Sidebar'
import BottomNav from './components/BottomNav'
import Landing from './pages/Landing'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import ShoppingList from './pages/ShoppingList'
import MealPlanner from './pages/MealPlanner'
import MealLog from './pages/MealLog'
import Recipes from './pages/Recipes'
import GrocerySpend from './pages/GrocerySpend'
import Household from './pages/Household'
import Settings from './pages/Settings'
import './App.css'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showAuth, setShowAuth] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
      if (session?.user) {
        upsertUserProfile(session.user)
      }
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session?.user) {
        upsertUserProfile(session.user)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function upsertUserProfile(user) {
    const name = user.email?.split('@')[0] || 'User'
    await supabase.from('user_profiles').upsert(
      {
        id: user.id,
        email: user.email,
        name,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
  }

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          gap: '0.75rem',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-body)',
        }}
      >
        <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
        Loading KitAura…
      </div>
    )
  }

  if (!session) {
    return showAuth
      ? <Auth />
      : <Landing onGetStarted={() => setShowAuth(true)} />
  }

  const user = session.user

  return (
    <div className="app-layout">
      <Sidebar user={user} />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard user={user} />} />
          <Route path="/inventory" element={<Inventory user={user} />} />
          <Route path="/shopping" element={<ShoppingList user={user} />} />
          <Route path="/meal-planner" element={<MealPlanner user={user} />} />
          <Route path="/meal-log" element={<MealLog user={user} />} />
          <Route path="/recipes" element={<Recipes user={user} />} />
          <Route path="/grocery-spend" element={<GrocerySpend user={user} />} />
          <Route path="/household" element={<Household user={user} />} />
          <Route path="/settings" element={<Settings user={user} />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}



