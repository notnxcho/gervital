import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/Layout/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard/Dashboard'
import ClientList from './pages/Clients/ClientList'
import ClientDetail from './pages/Clients/ClientDetail'
import AddClient from './pages/Clients/AddClient'
import AccessList from './pages/Access/AccessList'
import SupplierList from './pages/Suppliers/SupplierList'
import DailyGroups from './pages/Groups/DailyGroups'
import TransportScheduler from './pages/Transport/TransportScheduler'
import './App.css'

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />

          {/* Protected routes */}
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="clientes" element={<ClientList />} />
            <Route path="clientes/nuevo" element={<AddClient />} />
            <Route path="clientes/:id" element={<ClientDetail />} />
            <Route path="clientes/:id/editar" element={<AddClient />} />
            <Route path="grupos" element={<DailyGroups />} />
            <Route path="transporte" element={<TransportScheduler />} />
            <Route path="accesos" element={<AccessList />} />
            <Route path="proveedores" element={<SupplierList />} />
          </Route>

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
