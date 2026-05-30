import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  LayoutDashboard, Package, ShoppingCart, ChefHat,
  CalendarDays, BarChart3, Receipt, Users, Settings, LogOut,
} from 'lucide-react'
import './Sidebar.css'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/shopping', label: 'Shopping List', icon: ShoppingCart },
  { to: '/recipes', label: 'Recipes', icon: ChefHat },
  { to: '/meal-planner', label: 'Meal Planner', icon: CalendarDays },
  { to: '/meal-log', label: 'Meal Log', icon: BarChart3 },
  { to: '/grocery-spend', label: 'Grocery Spend', icon: Receipt },
  { to: '/household', label: 'Household', icon: Users },
]

export default function Sidebar({ user }) {
  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-icon">🌿</span>
        <span className="sidebar-logo-name">KitAura</span>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => 'sidebar-nav-item' + (isActive ? ' active' : '')}
          >
            <item.icon size={17} className="sidebar-nav-icon" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <NavLink
          to="/settings"
          className={({ isActive }) => 'sidebar-settings-link' + (isActive ? ' active' : '')}
        >
          <Settings size={15} />
          <span>Settings</span>
        </NavLink>

        <div className="sidebar-user">
          <div className="sidebar-user-avatar">
            {user?.email?.[0]?.toUpperCase() || 'U'}
          </div>
          <div className="sidebar-user-info">
            <span className="sidebar-user-email" title={user?.email}>
              {user?.email || 'User'}
            </span>
          </div>
        </div>

        <button className="btn btn-ghost btn-sm sidebar-signout" onClick={handleSignOut}>
          <LogOut size={14} />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
