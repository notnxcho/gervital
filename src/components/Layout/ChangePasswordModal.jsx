import { useState } from 'react'
import { changePassword } from '../../services/api'
import Modal from '../ui/Modal'
import Input from '../ui/Input'
import Button from '../ui/Button'

export default function ChangePasswordModal({ isOpen, onClose }) {
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleClose = () => {
    setForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setErrors({})
    setSuccess(false)
    onClose()
  }

  const validate = () => {
    const newErrors = {}
    if (!form.currentPassword) newErrors.currentPassword = 'Requerido'
    if (!form.newPassword) {
      newErrors.newPassword = 'Requerido'
    } else if (form.newPassword.length < 6) {
      newErrors.newPassword = 'Mínimo 6 caracteres'
    }
    if (form.newPassword !== form.confirmPassword) {
      newErrors.confirmPassword = 'Las contraseñas no coinciden'
    }
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return

    setLoading(true)
    setErrors({})
    try {
      await changePassword(form.currentPassword, form.newPassword)
      setSuccess(true)
      setTimeout(handleClose, 1500)
    } catch (error) {
      setErrors({ general: error.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Cambiar contraseña" size="sm">
      {success ? (
        <div className="text-center py-4">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-green-700 font-medium">Contraseña actualizada</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {errors.general && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {errors.general}
            </div>
          )}

          <Input
            label="Contraseña actual"
            type="password"
            value={form.currentPassword}
            onChange={(e) => setForm(prev => ({ ...prev, currentPassword: e.target.value }))}
            error={errors.currentPassword}
            autoComplete="current-password"
          />

          <Input
            label="Nueva contraseña"
            type="password"
            value={form.newPassword}
            onChange={(e) => setForm(prev => ({ ...prev, newPassword: e.target.value }))}
            error={errors.newPassword}
            autoComplete="new-password"
          />

          <Input
            label="Confirmar nueva contraseña"
            type="password"
            value={form.confirmPassword}
            onChange={(e) => setForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
            error={errors.confirmPassword}
            autoComplete="new-password"
          />

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="secondary" type="button" onClick={handleClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              Cambiar contraseña
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
