import { useState, useRef, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { Group, LogOut, Settings, Shop, Calendar, StatsReport, Lock, Bus } from 'iconoir-react'
import { useAuth } from '../../context/AuthContext'
import ChangePasswordModal from './ChangePasswordModal'

export default function Navbar() {
  const { user, logout, hasAccess } = useAuth()
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: StatsReport, access: 'clients' },
    { to: '/clientes', label: 'Clientes', icon: Group, access: 'clients' },
    { to: '/grupos', label: 'Grupos', icon: Calendar, access: 'clients' },
    { to: '/transporte', label: 'Transporte', icon: Bus, access: 'clients' },
    { to: '/proveedores', label: 'Proveedores', icon: Shop, access: 'suppliers' },
    { to: '/accesos', label: 'Accesos', icon: Settings, access: 'access' }
  ]

  return (
    <>
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

            {/* Usuario y menú */}
            <div className="flex items-center">
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">{user?.name}</p>
                    <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
                  </div>
                  <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                    <span className="text-xs font-semibold text-indigo-700">
                      {user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                    </span>
                  </div>
                </button>

                {showUserMenu && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg z-30 py-1">
                    <button
                      onClick={() => {
                        setShowUserMenu(false)
                        setShowPasswordModal(true)
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2.5"
                    >
                      <Lock className="w-4 h-4" />
                      Cambiar contraseña
                    </button>
                    <div className="border-t border-gray-100 my-1" />
                    <button
                      onClick={() => {
                        setShowUserMenu(false)
                        logout()
                      }}
                      className="w-full px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2.5"
                    >
                      <LogOut className="w-4 h-4" />
                      Cerrar sesión
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      <ChangePasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
      />
    </>
  )
}
