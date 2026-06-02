import { useState, useEffect } from 'react'
import { format, addMonths, subMonths } from 'date-fns'
import { es } from 'date-fns/locale'
import { useAuth } from '../../context/AuthContext'
import { 
  Plus, 
  NavArrowLeft, 
  NavArrowRight, 
  Check, 
  Clock, 
  Trash,
  Edit,
  Building
} from 'iconoir-react'
import {
  getSuppliers,
  getExpensesByMonth,
  createSupplier,
  createExpense,
  markExpenseAsPaid,
  deleteExpense,
  deleteSupplier,
  updateSupplier,
  updateExpense,
  SUPPLIER_CATEGORIES,
  getSalaries,
  createSalary,
  deactivateSalary,
  deleteSalary,
  SALARY_ONE_TIME_TYPES,
  salaryOneTimeLabel
} from '../../services/api'
import Button from '../../components/ui/Button'
import Card from '../../components/ui/Card'
import Modal from '../../components/ui/Modal'
import Input from '../../components/ui/Input'

export default function SupplierList() {
  const { hasAccess } = useAuth()
  const [suppliers, setSuppliers] = useState([])
  const [expenses, setExpenses] = useState([])
  const [salaries, setSalaries] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedDate, setSelectedDate] = useState(new Date())

  // Modals
  const [supplierModal, setSupplierModal] = useState({ open: false, supplier: null })
  const [expenseModal, setExpenseModal] = useState({ open: false, expense: null })
  const [deleteModal, setDeleteModal] = useState({ open: false, type: null, item: null })
  const [salaryModal, setSalaryModal] = useState({ open: false, kind: 'recurring' })
  
  const year = selectedDate.getFullYear()
  const month = selectedDate.getMonth()

  useEffect(() => {
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  const loadData = async () => {
    setLoading(true)
    try {
      const [suppliersData, expensesData] = await Promise.all([
        getSuppliers(),
        getExpensesByMonth(year, month)
      ])
      setSuppliers(suppliersData)
      setExpenses(expensesData)
      if (hasAccess('salaries')) {
        const salariesData = await getSalaries()
        setSalaries(salariesData)
      }
    } catch (error) {
      console.error('Error cargando datos:', error)
    } finally {
      setLoading(false)
    }
  }

  // Navegación de meses
  const goToPreviousMonth = () => setSelectedDate(subMonths(selectedDate, 1))
  const goToNextMonth = () => setSelectedDate(addMonths(selectedDate, 1))

  // Separar gastos por tipo
  const recurringExpenses = expenses.filter(e => e.type === 'recurring')
  const extraordinaryExpenses = expenses.filter(e => e.type === 'extraordinary')

  // Calcular totales
  const totalRecurring = recurringExpenses.reduce((sum, e) => sum + e.amount, 0)
  const totalExtraordinary = extraordinaryExpenses.reduce((sum, e) => sum + e.amount, 0)
  const totalMonth = totalRecurring + totalExtraordinary
  const totalPending = expenses.filter(e => e.status === 'pending').reduce((sum, e) => sum + e.amount, 0)

  // Obtener nombre de proveedor
  const getSupplierName = (supplierId) => {
    return suppliers.find(s => s.id === supplierId)?.name || 'Proveedor desconocido'
  }

  // Handlers
  const handleMarkPaid = async (expenseId) => {
    try {
      await markExpenseAsPaid(expenseId)
      loadData()
    } catch (error) {
      console.error('Error marcando como pagado:', error)
    }
  }

  const handleDeleteExpense = async () => {
    if (!deleteModal.item) return
    try {
      await deleteExpense(deleteModal.item.id)
      setDeleteModal({ open: false, type: null, item: null })
      loadData()
    } catch (error) {
      console.error('Error eliminando gasto:', error)
    }
  }

  const handleDeleteSupplier = async () => {
    if (!deleteModal.item) return
    try {
      await deleteSupplier(deleteModal.item.id)
      setDeleteModal({ open: false, type: null, item: null })
      loadData()
    } catch (error) {
      console.error('Error eliminando proveedor:', error)
    }
  }

  const handleDeactivateSalary = async (id) => {
    try {
      await deactivateSalary(id)
      loadData()
    } catch (error) {
      console.error('Error dando de baja sueldo:', error)
    }
  }

  const handleDeleteSalary = async (id) => {
    try {
      await deleteSalary(id)
      loadData()
    } catch (error) {
      console.error('Error eliminando sueldo:', error)
    }
  }

  return (
    <div className="bg-gray-50 min-h-screen -mt-8 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Proveedores y Gastos</h1>
          <p className="text-gray-500 text-sm mt-1">Gestión de costos operativos</p>
        </div>
        
        <div className="flex items-center gap-3">
          <Button 
            variant="secondary"
            onClick={() => setSupplierModal({ open: true, supplier: null })}
          >
            <Building className="w-4 h-4" />
            Nuevo proveedor
          </Button>
          <Button 
            onClick={() => setExpenseModal({ open: true, expense: null })}
            className="bg-purple-600 hover:bg-purple-700"
          >
            <Plus className="w-4 h-4" />
            Registrar gasto
          </Button>
        </div>
      </div>

      {/* Month selector */}
      <Card className="mb-6">
        <div className="p-4 flex items-center justify-between">
          <button 
            onClick={goToPreviousMonth}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <NavArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          
          <h2 className="text-xl font-semibold text-gray-900 capitalize">
            {format(selectedDate, 'MMMM yyyy', { locale: es })}
          </h2>
          
          <button 
            onClick={goToNextMonth}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <NavArrowRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <p className="text-sm text-gray-500">Total del mes</p>
          <p className="text-2xl font-bold text-gray-900">
            ${totalMonth.toLocaleString('es-AR')}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Gastos recurrentes</p>
          <p className="text-2xl font-bold text-blue-600">
            ${totalRecurring.toLocaleString('es-AR')}
          </p>
          <p className="text-xs text-gray-400">{recurringExpenses.length} servicios</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Gastos extraordinarios</p>
          <p className="text-2xl font-bold text-amber-600">
            ${totalExtraordinary.toLocaleString('es-AR')}
          </p>
          <p className="text-xs text-gray-400">{extraordinaryExpenses.length} gastos</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-gray-500">Pendiente de pago</p>
          <p className="text-2xl font-bold text-red-600">
            ${totalPending.toLocaleString('es-AR')}
          </p>
        </Card>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Gastos recurrentes */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500"></span>
              Gastos recurrentes
            </h3>
            
            {recurringExpenses.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-gray-500">No hay gastos recurrentes este mes</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {recurringExpenses.map(expense => (
                  <ExpenseCard
                    key={expense.id}
                    expense={expense}
                    supplierName={getSupplierName(expense.supplierId)}
                    onMarkPaid={() => handleMarkPaid(expense.id)}
                    onEdit={() => setExpenseModal({ open: true, expense })}
                    onDelete={() => setDeleteModal({ open: true, type: 'expense', item: expense })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Gastos extraordinarios */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-amber-500"></span>
              Gastos extraordinarios
            </h3>
            
            {extraordinaryExpenses.length === 0 ? (
              <Card className="p-6 text-center">
                <p className="text-gray-500">No hay gastos extraordinarios este mes</p>
              </Card>
            ) : (
              <div className="space-y-3">
                {extraordinaryExpenses.map(expense => (
                  <ExpenseCard
                    key={expense.id}
                    expense={expense}
                    supplierName={getSupplierName(expense.supplierId)}
                    onMarkPaid={() => handleMarkPaid(expense.id)}
                    onEdit={() => setExpenseModal({ open: true, expense })}
                    onDelete={() => setDeleteModal({ open: true, type: 'expense', item: expense })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Suppliers section */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Proveedores registrados ({suppliers.length})
        </h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {suppliers.map(supplier => (
            <Card key={supplier.id} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-semibold text-gray-900">{supplier.name}</h4>
                  <span className="inline-block mt-1 px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                    {supplier.category}
                  </span>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setSupplierModal({ open: true, supplier })}
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleteModal({ open: true, type: 'supplier', item: supplier })}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {supplier.contact && (
                <p className="text-sm text-gray-500 mt-2">{supplier.contact}</p>
              )}
              {supplier.phone && (
                <p className="text-sm text-gray-500">{supplier.phone}</p>
              )}
            </Card>
          ))}
        </div>
      </div>

      {/* Sueldos (solo superadmin) */}
      {hasAccess('salaries') && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Sueldos</h3>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setSalaryModal({ open: true, kind: 'recurring' })}
              >
                <Plus className="w-4 h-4" />
                Costo recurrente
              </Button>
              <Button
                onClick={() => setSalaryModal({ open: true, kind: 'one_time' })}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="w-4 h-4" />
                Costo puntual
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recurrentes activos */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Recurrentes mensuales</h4>
              {salaries.filter(s => s.kind === 'recurring' && s.active).length === 0 ? (
                <Card className="p-6 text-center"><p className="text-gray-500">Sin costos recurrentes</p></Card>
              ) : (
                <div className="space-y-3">
                  {salaries.filter(s => s.kind === 'recurring' && s.active).map(s => (
                    <Card key={s.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h5 className="font-medium text-gray-900">{s.concept || 'Sin concepto'}</h5>
                          {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-gray-900">${s.amount.toLocaleString('es-AR')}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 justify-end">
                        <button
                          onClick={() => handleDeactivateSalary(s.id)}
                          className="px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                        >
                          Dar de baja
                        </button>
                        <button
                          onClick={() => handleDeleteSalary(s.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Puntuales */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Puntuales</h4>
              {salaries.filter(s => s.kind === 'one_time').length === 0 ? (
                <Card className="p-6 text-center"><p className="text-gray-500">Sin costos puntuales</p></Card>
              ) : (
                <div className="space-y-3">
                  {salaries.filter(s => s.kind === 'one_time').map(s => (
                    <Card key={s.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h5 className="font-medium text-gray-900">{salaryOneTimeLabel(s.oneTimeType)}</h5>
                            {s.concept && <span className="text-xs text-gray-500">· {s.concept}</span>}
                          </div>
                          {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-gray-900">${s.amount.toLocaleString('es-AR')}</p>
                          {s.date && (
                            <p className="text-xs text-gray-400">{format(new Date(s.date), 'd MMM yyyy', { locale: es })}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 justify-end">
                        <button
                          onClick={() => handleDeleteSalary(s.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Supplier Modal */}
      <SupplierModal
        isOpen={supplierModal.open}
        onClose={() => setSupplierModal({ open: false, supplier: null })}
        supplier={supplierModal.supplier}
        onSave={loadData}
      />

      {/* Expense Modal */}
      <ExpenseModal
        isOpen={expenseModal.open}
        onClose={() => setExpenseModal({ open: false, expense: null })}
        expense={expenseModal.expense}
        suppliers={suppliers}
        selectedYear={year}
        selectedMonth={month}
        onSave={loadData}
      />

      {/* Salary Modal */}
      <SalaryModal
        isOpen={salaryModal.open}
        kind={salaryModal.kind}
        onClose={() => setSalaryModal({ open: false, kind: 'recurring' })}
        onSave={loadData}
      />

      {/* Delete Modal */}
      <Modal
        isOpen={deleteModal.open}
        onClose={() => setDeleteModal({ open: false, type: null, item: null })}
        title={deleteModal.type === 'supplier' ? 'Eliminar proveedor' : 'Eliminar gasto'}
      >
        <p className="text-gray-600 mb-6">
          ¿Estás seguro de que deseas eliminar {deleteModal.type === 'supplier' ? 'este proveedor' : 'este gasto'}? 
          Esta acción no se puede deshacer.
        </p>
        <div className="flex gap-3 justify-end">
          <Button
            variant="secondary"
            onClick={() => setDeleteModal({ open: false, type: null, item: null })}
          >
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={deleteModal.type === 'supplier' ? handleDeleteSupplier : handleDeleteExpense}
          >
            Eliminar
          </Button>
        </div>
      </Modal>
    </div>
  )
}

// Componente de tarjeta de gasto
function ExpenseCard({ expense, supplierName, onMarkPaid, onEdit, onDelete }) {
  const isPaid = expense.status === 'paid'
  
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h4 className="font-medium text-gray-900">{expense.description}</h4>
            {isPaid ? (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                <Check className="w-3 h-3" />
                Pagado
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                <Clock className="w-3 h-3" />
                Pendiente
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">{supplierName}</p>
          {expense.notes && (
            <p className="text-xs text-gray-400 mt-1">{expense.notes}</p>
          )}
        </div>
        <div className="text-right">
          <p className="text-lg font-semibold text-gray-900">
            ${expense.amount.toLocaleString('es-AR')}
          </p>
          <p className="text-xs text-gray-400">
            {format(new Date(expense.date), 'd MMM', { locale: es })}
          </p>
        </div>
      </div>
      
      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
        {!isPaid && (
          <Button
            size="sm"
            variant="success"
            className="flex-1"
            onClick={onMarkPaid}
          >
            <Check className="w-4 h-4" />
            Marcar pagado
          </Button>
        )}
        <button
          onClick={onEdit}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <Edit className="w-4 h-4" />
        </button>
        <button
          onClick={onDelete}
          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
        >
          <Trash className="w-4 h-4" />
        </button>
      </div>
    </Card>
  )
}

// Modal de proveedor
function SupplierModal({ isOpen, onClose, supplier, onSave }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: '',
    category: '',
    contact: '',
    phone: '',
    email: '',
    notes: ''
  })

  useEffect(() => {
    if (supplier) {
      setForm({
        name: supplier.name || '',
        category: supplier.category || '',
        contact: supplier.contact || '',
        phone: supplier.phone || '',
        email: supplier.email || '',
        notes: supplier.notes || ''
      })
    } else {
      setForm({
        name: '',
        category: '',
        contact: '',
        phone: '',
        email: '',
        notes: ''
      })
    }
  }, [supplier, isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    
    try {
      if (supplier) {
        await updateSupplier(supplier.id, form)
      } else {
        await createSupplier(form)
      }
      onSave()
      onClose()
    } catch (error) {
      console.error('Error guardando proveedor:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={supplier ? 'Editar proveedor' : 'Nuevo proveedor'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Nombre"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          required
        />
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Categoría
          </label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            required
          >
            <option value="">Seleccionar categoría</option>
            {SUPPLIER_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        <Input
          label="Contacto"
          value={form.contact}
          onChange={(e) => setForm({ ...form, contact: e.target.value })}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Teléfono"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notas
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            {supplier ? 'Guardar cambios' : 'Crear proveedor'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

// Modal de sueldo (recurrente o puntual)
function SalaryModal({ isOpen, kind, onClose, onSave }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    oneTimeType: 'aguinaldo',
    concept: '',
    description: '',
    amount: '',
    date: ''
  })

  useEffect(() => {
    setForm({ oneTimeType: 'aguinaldo', concept: '', description: '', amount: '', date: '' })
  }, [isOpen, kind])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await createSalary({
        kind,
        oneTimeType: form.oneTimeType,
        concept: form.concept,
        description: form.description,
        amount: parseFloat(form.amount),
        date: form.date
      })
      onSave()
      onClose()
    } catch (error) {
      console.error('Error guardando sueldo:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={kind === 'recurring' ? 'Nuevo costo recurrente' : 'Nuevo costo puntual'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {kind === 'one_time' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <select
              value={form.oneTimeType}
              onChange={(e) => setForm({ ...form, oneTimeType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              required
            >
              {SALARY_ONE_TIME_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        )}

        <Input
          label="Concepto"
          value={form.concept}
          onChange={(e) => setForm({ ...form, concept: e.target.value })}
          placeholder={kind === 'recurring' ? 'Ej: Sueldo coordinador' : 'Ej: Juan Pérez'}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Monto"
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="0"
            required
          />
          {kind === 'one_time' && (
            <Input
              label="Fecha"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="Detalles adicionales..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>Guardar</Button>
        </div>
      </form>
    </Modal>
  )
}

// Modal de gasto
function ExpenseModal({ isOpen, onClose, expense, suppliers, selectedYear, selectedMonth, onSave }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    supplierId: '',
    description: '',
    amount: '',
    type: 'recurring',
    date: '',
    notes: ''
  })

  useEffect(() => {
    if (expense) {
      setForm({
        supplierId: expense.supplierId || '',
        description: expense.description || '',
        amount: expense.amount?.toString() || '',
        type: expense.type || 'recurring',
        date: expense.date || '',
        notes: expense.notes || ''
      })
    } else {
      // Default date for new expense
      const defaultDate = new Date(selectedYear, selectedMonth, 1)
      setForm({
        supplierId: '',
        description: '',
        amount: '',
        type: 'recurring',
        date: format(defaultDate, 'yyyy-MM-dd'),
        notes: ''
      })
    }
  }, [expense, isOpen, selectedYear, selectedMonth])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    
    const expenseDate = new Date(form.date)
    const expenseData = {
      ...form,
      amount: parseFloat(form.amount),
      year: expenseDate.getFullYear(),
      month: expenseDate.getMonth()
    }
    
    try {
      if (expense) {
        await updateExpense(expense.id, expenseData)
      } else {
        await createExpense(expenseData)
      }
      onSave()
      onClose()
    } catch (error) {
      console.error('Error guardando gasto:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal 
      isOpen={isOpen} 
      onClose={onClose} 
      title={expense ? 'Editar gasto' : 'Registrar gasto'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Proveedor
          </label>
          <select
            value={form.supplierId}
            onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
            required
          >
            <option value="">Seleccionar proveedor</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <Input
          label="Descripción"
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Ej: Servicio de almuerzos mensual"
          required
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Monto"
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="0"
            required
          />
          <Input
            label="Fecha"
            type="date"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tipo de gasto
          </label>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setForm({ ...form, type: 'recurring' })}
              className={`
                flex-1 px-4 py-3 rounded-lg font-medium text-sm transition-colors border
                ${form.type === 'recurring'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}
              `}
            >
              Recurrente
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, type: 'extraordinary' })}
              className={`
                flex-1 px-4 py-3 rounded-lg font-medium text-sm transition-colors border
                ${form.type === 'extraordinary'
                  ? 'bg-amber-600 text-white border-amber-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'}
              `}
            >
              Extraordinario
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Notas
          </label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            placeholder="Detalles adicionales..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" loading={loading}>
            {expense ? 'Guardar cambios' : 'Registrar gasto'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
