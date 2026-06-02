import { useState, useEffect } from 'react'
import { Plus, Edit, Trash, Lock } from 'iconoir-react'
import { getUsers, createUser, updateUser, deleteUser, resetPassword } from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import Button from '../../components/ui/Button'
import Input, { Select } from '../../components/ui/Input'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'

// MOCKED RES - Opciones de roles
const ROLE_OPTIONS = [
  { value: 'operador', label: 'Operador' },
  { value: 'admin', label: 'Admin' },
  { value: 'superadmin', label: 'Superadmin' }
]

const ROLE_LABELS = {
  operador: 'Operador',
  admin: 'Admin',
  superadmin: 'Superadmin'
}

const ROLE_DESCRIPTIONS = {
  operador: 'Clientes, grupos, transporte, proveedores y gastos (sin información financiera)',
  admin: 'Todo lo del operador + precios, facturación y cobranza',
  superadmin: 'Acceso completo: usuarios, dashboard financiero y sueldos'
}

const ROLE_BADGE = {
  operador: { bg: 'bg-teal-100', text: 'text-teal-700' },
  admin: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  superadmin: { bg: 'bg-purple-100', text: 'text-purple-700' }
}
const roleBadge = (role) => ROLE_BADGE[role] || ROLE_BADGE.operador

export default function AccessList() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [deleteModal, setDeleteModal] = useState({ open: false, user: null })
  const [resetModal, setResetModal] = useState({ open: false, user: null })
  const [resetDone, setResetDone] = useState(false)
  const [formData, setFormData] = useState({ name: '', email: '', role: 'operador' })
  const [formLoading, setFormLoading] = useState(false)
  const [errors, setErrors] = useState({})
  
  const { user: currentUser } = useAuth()

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const data = await getUsers()
      setUsers(data)
    } catch (error) {
      console.error('Error cargando usuarios:', error)
    } finally {
      setLoading(false)
    }
  }

  const openCreateModal = () => {
    setEditingUser(null)
    setFormData({ name: '', email: '', role: 'operador' })
    setErrors({})
    setModalOpen(true)
  }

  const openEditModal = (user) => {
    setEditingUser(user)
    setFormData({ name: user.name, email: user.email, role: user.role })
    setErrors({})
    setModalOpen(true)
  }

  const validateForm = () => {
    const newErrors = {}
    if (!formData.name.trim()) newErrors.name = 'Requerido'
    if (!formData.email.trim()) newErrors.email = 'Requerido'
    if (!formData.email.includes('@')) newErrors.email = 'Email inválido'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return
    
    setFormLoading(true)
    try {
      if (editingUser) {
        await updateUser(editingUser.id, formData)
      } else {
        await createUser(formData)
      }
      await loadUsers()
      setModalOpen(false)
    } catch (error) {
      console.error('Error guardando usuario:', error)
    } finally {
      setFormLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteModal.user) return

    setFormLoading(true)
    try {
      await deleteUser(deleteModal.user.id)
      await loadUsers()
      setDeleteModal({ open: false, user: null })
    } catch (error) {
      console.error('Error eliminando usuario:', error)
    } finally {
      setFormLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!resetModal.user) return
    setFormLoading(true)
    try {
      await resetPassword(resetModal.user.authId)
      setResetDone(true)
    } catch (error) {
      console.error('Error reseteando contraseña:', error)
    } finally {
      setFormLoading(false)
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accesos</h1>
          <p className="text-sm text-gray-500 mt-1">
            Gestiona los usuarios y sus permisos
          </p>
        </div>
        <Button onClick={openCreateModal}>
          <Plus className="w-5 h-5" />
          Agregar usuario
        </Button>
      </div>

      {/* Roles info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <h3 className="font-medium text-gray-900">Operador</h3>
          <p className="text-sm text-gray-500 mt-1">{ROLE_DESCRIPTIONS.operador}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Clientes</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Grupos</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Transporte</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Proveedores</span>
            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">❌ Finanzas</span>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="font-medium text-gray-900">Admin</h3>
          <p className="text-sm text-gray-500 mt-1">{ROLE_DESCRIPTIONS.admin}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Operación</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Facturación</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Cobranza</span>
            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">❌ Usuarios</span>
            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">❌ Sueldos</span>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="font-medium text-gray-900">Superadmin</h3>
          <p className="text-sm text-gray-500 mt-1">{ROLE_DESCRIPTIONS.superadmin}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">✓ Todo</span>
          </div>
        </Card>
      </div>

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      ) : (
        /* User list */
        <div className="grid gap-4">
          {users.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-500">No hay usuarios registrados</p>
            </Card>
          ) : (
            users.map((user) => (
              <Card key={user.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    {/* Avatar */}
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${roleBadge(user.role).bg}`}>
                      <span className={`font-semibold text-lg ${roleBadge(user.role).text}`}>
                        {user.name.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
                    
                    {/* Info */}
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{user.name}</h3>
                        {user.id === currentUser?.id && (
                          <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full">
                            Tú
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-500">{user.email}</p>
                    </div>
                  </div>

                  {/* Role and actions */}
                  <div className="flex items-center gap-4">
                    <span className={`px-3 py-1 text-sm font-medium rounded-full ${roleBadge(user.role).bg} ${roleBadge(user.role).text}`}>
                      {ROLE_LABELS[user.role]}
                    </span>
                    
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditModal(user)}
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setResetDone(false); setResetModal({ open: true, user }) }}
                        title="Resetear contraseña"
                      >
                        <Lock className="w-4 h-4" />
                      </Button>
                      {user.id !== currentUser?.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteModal({ open: true, user })}
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        >
                          <Trash className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Create/Edit modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingUser ? 'Editar usuario' : 'Agregar usuario'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nombre"
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            error={errors.name}
            placeholder="Nombre completo"
          />
          <Input
            label="Email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
            error={errors.email}
            placeholder="email@gervital.com"
          />
          <Select
            label="Rol"
            value={formData.role}
            onChange={(e) => setFormData(prev => ({ ...prev, role: e.target.value }))}
            options={ROLE_OPTIONS}
          />
          
          {!editingUser && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                Contraseña inicial: <span className="font-mono font-semibold">Password1234!</span>
                <br />El usuario podrá cambiarla luego desde su menú.
              </p>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setModalOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={formLoading}>
              {editingUser ? 'Guardar cambios' : 'Crear usuario'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, user: null })}
        title="Eliminar usuario"
      >
        <p className="text-gray-600 mb-6">
          ¿Estás seguro de que deseas eliminar a{' '}
          <span className="font-semibold">{deleteModal.user?.name}</span>
          ? Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-3 justify-end">
          <Button
            variant="secondary"
            onClick={() => setDeleteModal({ open: false, user: null })}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={handleDelete}
            loading={formLoading}
          >
            Eliminar
          </Button>
        </div>
      </Modal>

      {/* Reset password modal */}
      <Modal
        isOpen={resetModal.open}
        onClose={() => setResetModal({ open: false, user: null })}
        title="Resetear contraseña"
      >
        {resetDone ? (
          <>
            <p className="text-gray-600 mb-6">
              La contraseña de <span className="font-semibold">{resetModal.user?.name}</span> se
              restableció a <span className="font-mono font-semibold">Password1234!</span>.
              Comunicásela al usuario.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setResetModal({ open: false, user: null })}>Listo</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-gray-600 mb-6">
              ¿Resetear la contraseña de <span className="font-semibold">{resetModal.user?.name}</span> a
              la contraseña inicial <span className="font-mono font-semibold">Password1234!</span>?
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setResetModal({ open: false, user: null })}>
                Cancelar
              </Button>
              <Button onClick={handleResetPassword} loading={formLoading}>
                Resetear
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
