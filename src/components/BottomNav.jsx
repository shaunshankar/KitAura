import { NavLink } from 'react-router-dom'
import './BottomNav.css'

const navItems = [
  { to: '/', label: 'Home', icon: '🏠', end: true },
  { to: '/inventory', label: 'Inventory', icon: '🥦' },
  { to: '/shopping', label: 'Shopping', icon: '🛒' },
  { to: '/recipes', label: 'Recipes', icon: '🍳' },
  { to: '/meal-planner', label: 'Planner', icon: '📅' },
  { to: '/meal-log', label: 'Log', icon: '📊' },
  { to: '/grocery-spend', label: 'Spend', icon: '💳' },
]

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            'bottom-nav-item' + (isActive ? ' active' : '')
          }
        >
          <span className="bottom-nav-icon">{item.icon}</span>
          <span className="bottom-nav-label">{item.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
