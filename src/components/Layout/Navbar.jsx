import { NavLink } from 'react-router-dom'
import { Group, LogOut, Settings, Shop, Calendar } from 'iconoir-react'
import { useAuth } from '../../context/AuthContext'

export default function Navbar() {
  const { user, logout, hasAccess } = useAuth()

  const navItems = [
    { to: '/clientes', label: 'Clientes', icon: Group, access: 'clients' },
    { to: '/grupos', label: 'Grupos', icon: Calendar, access: 'clients' },
    { to: '/proveedores', label: 'Proveedores', icon: Shop, access: 'suppliers' },
    { to: '/accesos', label: 'Accesos', icon: Settings, access: 'access' }
  ]

  return (
    <nav className="bg-white shadow-sm border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          {/* Logo y navegación */}
          <div className="flex items-center gap-8">
            <NavLink to="/clientes" className="flex items-center gap-2">
              <span className="text-xl font-bold text-indigo-600">Gervital</span>
            </NavLink>
            
            <div className="flex items-center gap-1">
              {navItems.map((item) => {
                if (!hasAccess(item.access)) return null
                
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                      }`
                    }
                  >
                    <item.icon className="w-5 h-5" />
                    {item.label}
                  </NavLink>
                )
              })}
            </div>
          </div>

          {/* Usuario y logout */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-sm font-medium text-gray-900">{user?.name}</p>
              <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
            </div>
            <button
              onClick={logout}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              title="Cerrar sesión"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </nav>
  )
}
