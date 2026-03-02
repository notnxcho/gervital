import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check } from 'iconoir-react'
import { createClient, updateClient, getClientById } from '../../services/api'
import { getPlanPricing, calculatePlanPriceSync } from '../../services/pricing/pricingService'
import Button from '../../components/ui/Button'
import Input, { Select, Textarea, Checkbox } from '../../components/ui/Input'
import Card, { CardContent } from '../../components/ui/Card'

// MOCKED RES - Opciones de planes
const FREQUENCY_OPTIONS = [
  { value: '1', label: '1 vez por semana' },
  { value: '2', label: '2 veces por semana' },
  { value: '3', label: '3 veces por semana' },
  { value: '4', label: '4 veces por semana' }
]

const SCHEDULE_OPTIONS = [
  { value: 'morning', label: 'Mañana' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'full_day', label: 'Día completo' }
]

const DAYS_OPTIONS = [
  { value: 'monday', label: 'Lunes' },
  { value: 'tuesday', label: 'Martes' },
  { value: 'wednesday', label: 'Miércoles' },
  { value: 'thursday', label: 'Jueves' },
  { value: 'friday', label: 'Viernes' }
]

// MOCKED RES - Opciones de tier cognitivo
const COGNITIVE_LEVEL_OPTIONS = [
  { value: 'A', label: 'A - Independiente' },
  { value: 'B', label: 'B - Asistencia leve' },
  { value: 'C', label: 'C - Asistencia moderada' },
  { value: 'D', label: 'D - Asistencia alta' }
]

const STEPS = [
  { id: 1, title: 'Datos personales y contacto' },
  { id: 2, title: 'Plan y asistencia' },
  { id: 3, title: 'Información médica' }
]

// MOCKED RES - Estado inicial del formulario
const INITIAL_FORM_DATA = {
  // Datos personales
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  birthDate: '',
  cognitiveLevel: 'A',
  startDate: new Date().toISOString().split('T')[0],
  // Contacto emergencia
  emergencyContactName: '',
  emergencyContactRelationship: '',
  emergencyContactPhone: '',
  // Dirección
  street: '',
  accessNotes: '',
  doorbell: '',
  concierge: '',
  // Plan
  frequency: '1',
  schedule: 'morning',
  hasTransport: false,
  assignedDays: [],
  // Médico
  dietaryRestrictions: '',
  medicalRestrictions: '',
  mobilityRestrictions: '',
  medication: '',
  medicationSchedule: '',
  notes: ''
}

export default function AddClient() {
  const navigate = useNavigate()
  const { id } = useParams()
  const isEditMode = Boolean(id)
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA)
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [loadingClient, setLoadingClient] = useState(false)
  const [pricingData, setPricingData] = useState([])

  useEffect(() => {
    getPlanPricing()
      .then(setPricingData)
      .catch(err => console.error('Error cargando precios:', err))
  }, [])

  useEffect(() => {
    if (!isEditMode) return
    setLoadingClient(true)
    getClientById(id)
      .then(client => {
        if (!client) return
        setFormData({
          firstName: client.firstName || '',
          lastName: client.lastName || '',
          email: client.email || '',
          phone: client.phone || '',
          birthDate: client.birthDate || '',
          cognitiveLevel: client.cognitiveLevel || 'A',
          startDate: client.startDate || '',
          emergencyContactName: client.emergencyContact?.name || '',
          emergencyContactRelationship: client.emergencyContact?.relationship || '',
          emergencyContactPhone: client.emergencyContact?.phone || '',
          street: client.address?.street || '',
          accessNotes: client.address?.accessNotes || '',
          doorbell: client.address?.doorbell || '',
          concierge: client.address?.concierge || '',
          frequency: String(client.plan?.frequency || 1),
          schedule: client.plan?.schedule || 'morning',
          hasTransport: client.plan?.hasTransport || false,
          assignedDays: client.plan?.assignedDays || [],
          dietaryRestrictions: client.medicalInfo?.dietaryRestrictions || '',
          medicalRestrictions: client.medicalInfo?.medicalRestrictions || '',
          mobilityRestrictions: client.medicalInfo?.mobilityRestrictions || '',
          medication: client.medicalInfo?.medication || '',
          medicationSchedule: client.medicalInfo?.medicationSchedule || '',
          notes: client.medicalInfo?.notes || ''
        })
      })
      .catch(err => console.error('Error cargando cliente:', err))
      .finally(() => setLoadingClient(false))
  }, [id, isEditMode])

  const updateField = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
    // Clear error when field is updated
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }))
    }
  }

  const toggleDay = (day) => {
    setFormData(prev => ({
      ...prev,
      assignedDays: prev.assignedDays.includes(day)
        ? prev.assignedDays.filter(d => d !== day)
        : [...prev.assignedDays, day]
    }))
  }

  const validateStep = (step) => {
    const newErrors = {}
    
    if (step === 1) {
      if (!formData.firstName.trim()) newErrors.firstName = 'Requerido'
      if (!formData.lastName.trim()) newErrors.lastName = 'Requerido'
      if (!formData.email.trim()) newErrors.email = 'Requerido'
      if (!formData.phone.trim()) newErrors.phone = 'Requerido'
      if (!formData.birthDate) newErrors.birthDate = 'Requerido'
      if (!formData.emergencyContactName.trim()) newErrors.emergencyContactName = 'Requerido'
      if (!formData.emergencyContactPhone.trim()) newErrors.emergencyContactPhone = 'Requerido'
      if (!formData.street.trim()) newErrors.street = 'Requerido'
    }
    
    if (step === 2) {
      if (formData.assignedDays.length === 0) {
        newErrors.assignedDays = 'Selecciona al menos un día'
      }
      if (formData.assignedDays.length !== parseInt(formData.frequency)) {
        newErrors.assignedDays = `Debes seleccionar exactamente ${formData.frequency} día(s)`
      }
    }
    
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCurrentStep(prev => prev + 1)
    }
  }

  const handleBack = () => {
    setCurrentStep(prev => prev - 1)
  }

  const handleSubmit = async () => {
    if (!validateStep(3)) return
    
    setLoading(true)
    try {
      const clientData = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        phone: formData.phone,
        birthDate: formData.birthDate,
        cognitiveLevel: formData.cognitiveLevel,
        startDate: formData.startDate,
        plan: {
          frequency: parseInt(formData.frequency),
          schedule: formData.schedule,
          hasTransport: formData.hasTransport,
          assignedDays: formData.assignedDays
        },
        emergencyContact: {
          name: formData.emergencyContactName,
          relationship: formData.emergencyContactRelationship,
          phone: formData.emergencyContactPhone
        },
        address: {
          street: formData.street,
          accessNotes: formData.accessNotes,
          doorbell: formData.doorbell,
          concierge: formData.concierge
        },
        medicalInfo: {
          dietaryRestrictions: formData.dietaryRestrictions,
          medicalRestrictions: formData.medicalRestrictions,
          mobilityRestrictions: formData.mobilityRestrictions,
          medication: formData.medication,
          medicationSchedule: formData.medicationSchedule,
          notes: formData.notes
        }
      }
      
      if (isEditMode) {
        await updateClient(id, clientData)
        navigate(`/clientes/${id}`)
      } else {
        await createClient(clientData)
        navigate('/clientes')
      }
    } catch (error) {
      console.error('Error creando cliente:', error)
    } finally {
      setLoading(false)
    }
  }

  const estimatedPrice = calculatePlanPriceSync(
    pricingData,
    parseInt(formData.frequency),
    formData.schedule,
    formData.hasTransport
  )

  if (loadingClient) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" size="sm" onClick={() => navigate(isEditMode ? `/clientes/${id}` : '/clientes')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {isEditMode ? 'Editar cliente' : 'Agregar cliente'}
          </h1>
          <p className="text-sm text-gray-500">
            {isEditMode ? 'Modifica la información del cliente' : 'Completa la información del nuevo cliente'}
          </p>
        </div>
      </div>

      {/* Steps indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center">
              <div className="flex items-center">
                <div className={`
                  w-10 h-10 rounded-full flex items-center justify-center font-medium text-sm
                  ${currentStep > step.id 
                    ? 'bg-indigo-600 text-white' 
                    : currentStep === step.id 
                      ? 'bg-indigo-600 text-white' 
                      : 'bg-gray-200 text-gray-600'}
                `}>
                  {currentStep > step.id ? <Check className="w-5 h-5" /> : step.id}
                </div>
                <span className={`ml-3 text-sm font-medium ${
                  currentStep >= step.id ? 'text-gray-900' : 'text-gray-500'
                }`}>
                  {step.title}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div className={`w-24 h-0.5 mx-4 ${
                  currentStep > step.id ? 'bg-indigo-600' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Form content */}
      <Card>
        <CardContent className="p-6">
          {/* Step 1: Datos personales y contacto */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Datos personales</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Nombre"
                    value={formData.firstName}
                    onChange={(e) => updateField('firstName', e.target.value)}
                    error={errors.firstName}
                    placeholder="María"
                  />
                  <Input
                    label="Apellido"
                    value={formData.lastName}
                    onChange={(e) => updateField('lastName', e.target.value)}
                    error={errors.lastName}
                    placeholder="González"
                  />
                  <Input
                    label="Email (para facturación)"
                    type="email"
                    value={formData.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    error={errors.email}
                    placeholder="familia@email.com"
                  />
                  <Input
                    label="Teléfono"
                    value={formData.phone}
                    onChange={(e) => updateField('phone', e.target.value)}
                    error={errors.phone}
                    placeholder="+54 11 1234-5678"
                  />
                  <Input
                    label="Fecha de nacimiento"
                    type="date"
                    value={formData.birthDate}
                    onChange={(e) => updateField('birthDate', e.target.value)}
                    error={errors.birthDate}
                  />
                  <Select
                    label="Tier cognitivo"
                    value={formData.cognitiveLevel}
                    onChange={(e) => updateField('cognitiveLevel', e.target.value)}
                    options={COGNITIVE_LEVEL_OPTIONS}
                  />
                  <Input
                    label="Fecha de ingreso"
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => updateField('startDate', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Contacto de emergencia</h3>
                <div className="grid grid-cols-3 gap-4">
                  <Input
                    label="Nombre"
                    value={formData.emergencyContactName}
                    onChange={(e) => updateField('emergencyContactName', e.target.value)}
                    error={errors.emergencyContactName}
                    placeholder="Carlos González"
                  />
                  <Input
                    label="Vínculo"
                    value={formData.emergencyContactRelationship}
                    onChange={(e) => updateField('emergencyContactRelationship', e.target.value)}
                    placeholder="Hijo/a"
                  />
                  <Input
                    label="Teléfono"
                    value={formData.emergencyContactPhone}
                    onChange={(e) => updateField('emergencyContactPhone', e.target.value)}
                    error={errors.emergencyContactPhone}
                    placeholder="+54 11 8765-4321"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Dirección</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Dirección"
                    value={formData.street}
                    onChange={(e) => updateField('street', e.target.value)}
                    error={errors.street}
                    placeholder="Av. Corrientes 1234, CABA"
                    className="col-span-2"
                  />
                  <Input
                    label="Timbre"
                    value={formData.doorbell}
                    onChange={(e) => updateField('doorbell', e.target.value)}
                    placeholder="4B"
                  />
                  <Input
                    label="Portería"
                    value={formData.concierge}
                    onChange={(e) => updateField('concierge', e.target.value)}
                    placeholder="De 8 a 20hs"
                  />
                  <Textarea
                    label="Observaciones de acceso"
                    value={formData.accessNotes}
                    onChange={(e) => updateField('accessNotes', e.target.value)}
                    placeholder="Indicaciones especiales para llegar..."
                    className="col-span-2"
                    rows={2}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Plan y asistencia */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Plan de asistencia</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Select
                    label="Frecuencia"
                    value={formData.frequency}
                    onChange={(e) => {
                      updateField('frequency', e.target.value)
                      updateField('assignedDays', []) // Reset days when frequency changes
                    }}
                    options={FREQUENCY_OPTIONS}
                  />
                  <Select
                    label="Horario"
                    value={formData.schedule}
                    onChange={(e) => updateField('schedule', e.target.value)}
                    options={SCHEDULE_OPTIONS}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Días asignados (selecciona {formData.frequency})
                </label>
                <div className="flex gap-2">
                  {DAYS_OPTIONS.map((day) => (
                    <button
                      key={day.value}
                      type="button"
                      onClick={() => toggleDay(day.value)}
                      className={`
                        px-4 py-2 rounded-lg font-medium text-sm transition-colors
                        ${formData.assignedDays.includes(day.value)
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}
                      `}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
                {errors.assignedDays && (
                  <p className="mt-1 text-sm text-red-600">{errors.assignedDays}</p>
                )}
              </div>

              <div>
                <Checkbox
                  label="Incluir transporte"
                  checked={formData.hasTransport}
                  onChange={(e) => updateField('hasTransport', e.target.checked)}
                />
                <p className="text-sm text-gray-500 mt-1 ml-6">
                  El transporte tiene un costo adicional del 20%
                </p>
              </div>

              {/* Price preview */}
              <div className="bg-indigo-50 rounded-lg p-4">
                <p className="text-sm text-indigo-700">Precio mensual estimado</p>
                <p className="text-2xl font-bold text-indigo-900">
                  ${estimatedPrice.toLocaleString()}
                </p>
                <p className="text-xs text-indigo-600 mt-1">
                  {formData.frequency}x/semana • {SCHEDULE_OPTIONS.find(s => s.value === formData.schedule)?.label}
                  {formData.hasTransport && ' • Con transporte'}
                </p>
              </div>
            </div>
          )}

          {/* Step 3: Información médica */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Restricciones</h3>
                <div className="grid grid-cols-1 gap-4">
                  <Textarea
                    label="Restricciones alimentarias"
                    value={formData.dietaryRestrictions}
                    onChange={(e) => updateField('dietaryRestrictions', e.target.value)}
                    placeholder="Ej: Sin gluten, diabético, vegetariano..."
                    rows={2}
                  />
                  <Textarea
                    label="Restricciones médicas"
                    value={formData.medicalRestrictions}
                    onChange={(e) => updateField('medicalRestrictions', e.target.value)}
                    placeholder="Ej: Hipertensión, diabetes, problemas cardíacos..."
                    rows={2}
                  />
                  <Textarea
                    label="Restricciones de movilidad"
                    value={formData.mobilityRestrictions}
                    onChange={(e) => updateField('mobilityRestrictions', e.target.value)}
                    placeholder="Ej: Usa bastón, silla de ruedas, dificultad para escaleras..."
                    rows={2}
                  />
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Medicación</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Textarea
                    label="Medicación"
                    value={formData.medication}
                    onChange={(e) => updateField('medication', e.target.value)}
                    placeholder="Nombre y dosis de medicamentos..."
                    rows={2}
                    className="col-span-2"
                  />
                  <Input
                    label="Horario de medicación"
                    value={formData.medicationSchedule}
                    onChange={(e) => updateField('medicationSchedule', e.target.value)}
                    placeholder="Ej: 8:00 y 20:00"
                    className="col-span-2"
                  />
                </div>
              </div>

              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Notas adicionales</h3>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => updateField('notes', e.target.value)}
                  placeholder="Cualquier información adicional relevante..."
                  rows={3}
                />
              </div>
            </div>
          )}

          {/* Navigation buttons */}
          <div className="flex justify-between mt-8 pt-6 border-t border-gray-200">
            <Button
              variant="secondary"
              onClick={currentStep === 1 ? () => navigate('/clientes') : handleBack}
            >
              {currentStep === 1 ? 'Cancelar' : 'Anterior'}
            </Button>
            
            {currentStep < 3 ? (
              <Button onClick={handleNext}>
                Siguiente
              </Button>
            ) : (
              <Button onClick={handleSubmit} loading={loading}>
                {isEditMode ? 'Guardar cambios' : 'Crear cliente'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
