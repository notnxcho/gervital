import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// Route guard: renders children only if the user has access to `feature`,
// otherwise redirects to the dashboard.
export default function RequireRole({ feature }) {
  const { hasAccess } = useAuth()
  if (!hasAccess(feature)) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
