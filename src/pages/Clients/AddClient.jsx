import { useState, useEffect, useRef } from 'react'
import { formatCurrency } from '../../utils/format'
import { useNavigate, useParams } from 'react-router-dom'
import { useJsApiLoader } from '@react-google-maps/api'
import { ArrowLeft, Check, Plus, Trash, Bus, MapPin } from 'iconoir-react'
import { createClient, updateClient, getClientById, uploadClientAvatar, updateClientAddressCoords, getClientInvoices, setClientPlanVersion, syncClientToBiller, voidPendingInvoices } from '../../services/api'
import LocationPickerModal from './LocationPickerModal'
import { geocodeWithGoogle, haversineKm, distanceToRange } from '../../services/clients/geocodingService'
import { CLUB_LOCATION } from '../../services/transport/transportConstants'
import { getPlanPricing, getPlanPriceSync, calculateMonthProration } from '../../services/pricing/pricingService'
import { getTransportPricing, getTransportPriceSync } from '../../services/pricing/transportPricingService'
import Button from '../../components/ui/Button'
import Input, { Select, Textarea, Checkbox } from '../../components/ui/Input'
import { CLIENT_TYPES, CLIENT_TYPE_META, isNonBillableType } from '../../services/clients/clientTypes'
import Card, { CardContent } from '../../components/ui/Card'
import { useAuth } from '../../context/AuthContext'
import { RepeatableRows } from './medical/RepeatableRows'
import { MARITAL_STATUS_OPTIONS, RESIDENCE_TYPE_OPTIONS, CHARACTER_OPTIONS, DIAGNOSIS_TYPE_OPTIONS, MEDICAL_HISTORY_CONDITIONS } from '../../services/clients/medicalConstants'

const MONTH_NAMES_ES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

const DISTANCE_LABELS = { '0_to_2km': '0 a 2 km', '2_to_5km': '2 a 5 km', '5_to_10km': '5 a 10 km' }

// Build month options from floorKey ('YYYY-MM') through floor + 6 months.
function buildEffectiveMonthOptions(floorKey) {
  if (!floorKey) return []
  const [fy, fm] = floorKey.split('-').map(Number)
  const options = []
  for (let i = 0; i <= 6; i++) {
    const d = new Date(fy, fm - 1 + i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = `${MONTH_NAMES_ES[d.getMonth()]} ${d.getFullYear()}`
    options.push({ value, label })
  }
  return options
}

// MOCKED RES - Opciones de planes
const FREQUENCY_OPTIONS = [
  { value: '1', label: '1 vez por semana' },
  { value: '2', label: '2 veces por semana' },
  { value: '3', label: '3 veces por semana' },
  { value: '4', label: '4 veces por semana' },
  { value: '5', label: '5 veces por semana' }
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

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'ci', label: 'Cédula (CI)' },
  { value: 'rut', label: 'RUT' },
  { value: 'dni', label: 'DNI' },
  { value: 'pasaporte', label: 'Pasaporte' },
  { value: 'otro', label: 'Otro' }
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
  documentType: 'ci',
  documentNumber: '',
  // Responsable de transferencia (texto libre)
  transferResponsible: '',
  // Contactos de emergencia (1..5)
  emergencyContacts: [{ name: '', relationship: '', phone: '' }],
  // Dirección
  street: '',
  accessNotes: '',
  doorbell: '',
  concierge: '',
  distanceRange: '',
  latitude: null,
  longitude: null,
  // Plan
  frequency: '1',
  schedule: 'morning',
  hasTransport: false,
  assignedDays: [],
  // Personal extra
  maritalStatus: '',
  residenceType: '',
  livesWith: '',
  // Servicio de salud
  healthEmergencyService: '',
  healthProvider: '',
  healthNotes: '',
  // Tratamiento farmacológico
  medications: [],
  medicationNotes: '',
  // Antecedentes
  medicalHistory: [], // [{condition, comment}]
  historyNotes: '',
  // Diagnóstico
  diagnoses: [], // [{diagnosisType, behaviorDisorder}]
  // Historia de vida
  educationLevel: '',
  occupation: '',
  significantInterests: '',
  significantBonds: '',
  musicTaste: '',
  favoriteFoods: '',
  character: '',
  personalResources: '',
  vulnerabilities: '',
  // Tipo de cliente: regular | charity | trial (write admin-gated)
  clientType: 'regular'
}

export default function AddClient() {
  const navigate = useNavigate()
  const { hasAccess } = useAuth()
  const { id } = useParams()
  const isEditMode = Boolean(id)
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState(INITIAL_FORM_DATA)
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(false)
  const [loadingClient, setLoadingClient] = useState(false)
  const [pricingData, setPricingData] = useState([])
  const [transportPricingData, setTransportPricingData] = useState([])
  const [avatarFile, setAvatarFile] = useState(null)
  const [avatarPreview, setAvatarPreview] = useState(null)
  const [showLocationModal, setShowLocationModal] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [planEffectiveFrom, setPlanEffectiveFrom] = useState('')
  const [planFloorMonth, setPlanFloorMonth] = useState('')
  const geocoderRef = useRef(null)
  // Street value the current coords were derived from — lets us re-geocode only when
  // the address actually changes, preserving a manual pin correction otherwise.
  const lastGeocodedStreetRef = useRef('')
  const { isLoaded: mapsLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.REACT_APP_GOOGLE_MAPS_API_KEY || ''
  })

  useEffect(() => {
    getPlanPricing()
      .then(setPricingData)
      .catch(err => console.error('Error cargando precios:', err))
    getTransportPricing()
      .then(setTransportPricingData)
      .catch(err => console.error('Error cargando precios de transporte:', err))
  }, [])

  useEffect(() => {
    if (!isEditMode) return
    setLoadingClient(true)
    getClientById(id)
      .then(async client => {
        if (!client) return
        if (client.avatarUrl) {
          setAvatarPreview(client.avatarUrl)
        }
        // Seed with the loaded street so the first blur (without an edit) keeps stored coords.
        lastGeocodedStreetRef.current = client.address?.street?.trim() || ''
        setFormData({
          firstName: client.firstName || '',
          lastName: client.lastName || '',
          email: client.email || '',
          phone: client.phone || '',
          birthDate: client.birthDate || '',
          cognitiveLevel: client.cognitiveLevel || 'A',
          startDate: client.startDate || '',
          documentType: client.documentType || 'ci',
          documentNumber: client.documentNumber || '',
          transferResponsible: client.transferResponsible || '',
          emergencyContacts: (client.emergencyContacts?.length
            ? client.emergencyContacts
            : (client.emergencyContact ? [client.emergencyContact] : [{ name: '', relationship: '', phone: '' }])
          ).map(c => ({ name: c.name || '', relationship: c.relationship || '', phone: c.phone || '' })),
          street: client.address?.street || '',
          accessNotes: client.address?.accessNotes || '',
          doorbell: client.address?.doorbell || '',
          concierge: client.address?.concierge || '',
          distanceRange: client.address?.distanceRange || '',
          latitude: client.address?.latitude ?? null,
          longitude: client.address?.longitude ?? null,
          frequency: String(client.plan?.frequency || 1),
          schedule: client.plan?.schedule || 'morning',
          hasTransport: client.plan?.hasTransport || false,
          assignedDays: client.plan?.assignedDays || [],
          maritalStatus: client.maritalStatus || '',
          residenceType: client.residenceType || '',
          livesWith: client.livesWith || '',
          healthEmergencyService: client.medicalInfo?.healthEmergencyService || '',
          healthProvider: client.medicalInfo?.healthProvider || '',
          healthNotes: client.medicalInfo?.healthNotes || '',
          medications: client.medications || [],
          medicationNotes: client.medicalInfo?.medicationNotes || '',
          medicalHistory: client.medicalHistory || [],
          historyNotes: client.medicalInfo?.historyNotes || '',
          diagnoses: client.diagnoses || [],
          educationLevel: client.medicalInfo?.educationLevel || '',
          occupation: client.medicalInfo?.occupation || '',
          significantInterests: client.medicalInfo?.significantInterests || '',
          significantBonds: client.medicalInfo?.significantBonds || '',
          musicTaste: client.medicalInfo?.musicTaste || '',
          favoriteFoods: client.medicalInfo?.favoriteFoods || '',
          character: client.medicalInfo?.character || '',
          personalResources: client.medicalInfo?.personalResources || '',
          vulnerabilities: client.medicalInfo?.vulnerabilities || '',
          clientType: client.clientType || 'regular'
        })

        const invoices = await getClientInvoices(id).catch(() => [])
        const unpaid = invoices
          .filter(inv => inv.paymentStatus !== 'paid')
          .sort((a, b) => (a.year - b.year) || (a.month - b.month))
        const now = new Date()
        const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
        const floorKey = unpaid.length
          ? `${unpaid[0].year}-${String(unpaid[0].month + 1).padStart(2, '0')}`
          : currentKey
        setPlanFloorMonth(floorKey)
        setPlanEffectiveFrom(currentKey < floorKey ? floorKey : currentKey)
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

  // On blur, geocode the typed address with Google and auto-fill coords + distance range.
  // Skips when the street is unchanged so a manual pin correction (from the map modal) is kept.
  const handleStreetBlur = async () => {
    const street = formData.street?.trim()
    if (!street || street.length < 5 || !mapsLoaded) return
    if (street === lastGeocodedStreetRef.current) return
    geocoderRef.current = geocoderRef.current || new window.google.maps.Geocoder()
    setGeocoding(true)
    const g = await geocodeWithGoogle(geocoderRef.current, street)
    setGeocoding(false)
    if (!g) return
    lastGeocodedStreetRef.current = street
    const range = distanceToRange(haversineKm(g.lat, g.lng, CLUB_LOCATION.lat, CLUB_LOCATION.lng))
    setFormData(prev => ({ ...prev, latitude: g.lat, longitude: g.lng, distanceRange: range }))
  }

  // Antecedentes: estado derivado de formData.medicalHistory ([{condition, comment}])
  const historyByCondition = Object.fromEntries((formData.medicalHistory || []).map(h => [h.condition, h]))
  const toggleCondition = (cond, checked) => {
    setFormData(prev => ({
      ...prev,
      medicalHistory: checked
        ? [...(prev.medicalHistory || []), { condition: cond, comment: '' }]
        : (prev.medicalHistory || []).filter(h => h.condition !== cond)
    }))
  }
  const setConditionComment = (cond, comment) => {
    setFormData(prev => ({
      ...prev,
      medicalHistory: (prev.medicalHistory || []).map(h => h.condition === cond ? { ...h, comment } : h)
    }))
  }

  const toggleDay = (day) => {
    setFormData(prev => ({
      ...prev,
      assignedDays: prev.assignedDays.includes(day)
        ? prev.assignedDays.filter(d => d !== day)
        : [...prev.assignedDays, day]
    }))
  }

  const MAX_EMERGENCY_CONTACTS = 5

  const updateContact = (index, field, value) => {
    setFormData(prev => ({
      ...prev,
      emergencyContacts: prev.emergencyContacts.map((c, i) => i === index ? { ...c, [field]: value } : c)
    }))
    if (errors[`ec_${index}_${field}`]) {
      setErrors(prev => ({ ...prev, [`ec_${index}_${field}`]: null }))
    }
  }

  const addContact = () => {
    setFormData(prev => prev.emergencyContacts.length >= MAX_EMERGENCY_CONTACTS
      ? prev
      : { ...prev, emergencyContacts: [...prev.emergencyContacts, { name: '', relationship: '', phone: '' }] })
  }

  const removeContact = (index) => {
    setFormData(prev => prev.emergencyContacts.length <= 1
      ? prev
      : { ...prev, emergencyContacts: prev.emergencyContacts.filter((_, i) => i !== index) })
  }

  const validateStep = (step) => {
    const newErrors = {}
    
    if (step === 1) {
      if (!formData.firstName.trim()) newErrors.firstName = 'Requerido'
      if (!formData.lastName.trim()) newErrors.lastName = 'Requerido'
      if (!formData.email.trim()) newErrors.email = 'Requerido'
      if (!formData.phone.trim()) newErrors.phone = 'Requerido'
      if (!formData.birthDate) newErrors.birthDate = 'Requerido'
      if (!formData.documentNumber.trim()) newErrors.documentNumber = 'Requerido'
      formData.emergencyContacts.forEach((c, i) => {
        if (!c.name.trim()) newErrors[`ec_${i}_name`] = 'Requerido'
        if (!c.phone.trim()) newErrors[`ec_${i}_phone`] = 'Requerido'
      })
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
        documentType: formData.documentType,
        documentNumber: formData.documentNumber,
        transferResponsible: formData.transferResponsible,
        clientType: formData.clientType,
        plan: {
          frequency: parseInt(formData.frequency),
          schedule: formData.schedule,
          hasTransport: formData.hasTransport,
          assignedDays: formData.assignedDays
        },
        emergencyContacts: formData.emergencyContacts
          .map(c => ({ name: c.name.trim(), relationship: c.relationship.trim(), phone: c.phone.trim() }))
          .filter(c => c.name && c.phone),
        address: {
          street: formData.street,
          accessNotes: formData.accessNotes,
          doorbell: formData.doorbell,
          concierge: formData.concierge,
          latitude: formData.latitude,
          longitude: formData.longitude,
          distanceRange: formData.distanceRange
        },
        maritalStatus: formData.maritalStatus,
        residenceType: formData.residenceType,
        livesWith: formData.livesWith,
        medicalInfo: {
          healthEmergencyService: formData.healthEmergencyService,
          healthProvider: formData.healthProvider,
          healthNotes: formData.healthNotes,
          medicationNotes: formData.medicationNotes,
          historyNotes: formData.historyNotes,
          educationLevel: formData.educationLevel,
          occupation: formData.occupation,
          significantInterests: formData.significantInterests,
          significantBonds: formData.significantBonds,
          musicTaste: formData.musicTaste,
          favoriteFoods: formData.favoriteFoods,
          character: formData.character,
          personalResources: formData.personalResources,
          vulnerabilities: formData.vulnerabilities
        },
        medications: formData.medications,
        diagnoses: formData.diagnoses,
        medicalHistory: formData.medicalHistory
      }
      
      if (isEditMode) {
        await updateClient(id, clientData)
        const effFrom = `${planEffectiveFrom}-01`
        await setClientPlanVersion(id, effFrom, {
          frequency: parseInt(formData.frequency),
          schedule: formData.schedule,
          hasTransport: formData.hasTransport,
          assignedDays: formData.assignedDays,
          distanceRange: clientData.address.distanceRange
        })
        if (formData.latitude != null && formData.longitude != null) {
          await updateClientAddressCoords(id, formData.latitude, formData.longitude).catch(console.error)
        }
        if (avatarFile) {
          await uploadClientAvatar(id, avatarFile).catch(console.error)
        }
        // No facturables (beneficencia / a prueba): anular facturas pendientes no
        // emitidas ni pagadas (idempotente).
        if (isNonBillableType(formData.clientType)) {
          await voidPendingInvoices(id).catch(err => console.warn('Void facturas falló:', err))
        }
        // Re-sync receptor en Biller: los datos fiscales (nombre/CI/dirección/email) pudieron cambiar.
        // No se sincroniza a clientes no facturables (beneficencia / a prueba).
        if (formData.documentNumber && !isNonBillableType(formData.clientType)) {
          syncClientToBiller(id, true).catch(err => console.warn('Re-sync Biller falló:', err))
        }
        navigate(`/clientes/${id}`)
      } else {
        const newClient = await createClient(clientData)
        if (formData.latitude != null && formData.longitude != null && newClient?.id) {
          await updateClientAddressCoords(newClient.id, formData.latitude, formData.longitude).catch(console.error)
        }
        if (avatarFile && newClient?.id) {
          await uploadClientAvatar(newClient.id, avatarFile).catch(console.error)
        }
        // Sync receptor en Biller. No bloquea el alta: el cliente ya quedó creado.
        // No se sincroniza a clientes no facturables (beneficencia / a prueba).
        if (newClient?.id && formData.documentNumber && !isNonBillableType(formData.clientType)) {
          try {
            await syncClientToBiller(newClient.id)
          } catch (err) {
            console.warn('Sync Biller falló:', err)
            window.alert(`Cliente creado, pero no se pudo sincronizar con Biller: ${err.message}\n\nPodés reintentar desde el detalle del cliente.`)
          }
        }
        navigate('/clientes')
      }
    } catch (error) {
      console.error(isEditMode ? 'Error guardando cliente:' : 'Error creando cliente:', error)
    } finally {
      setLoading(false)
    }
  }

  const previewDate = formData.startDate ? new Date(`${formData.startDate}T00:00:00`) : new Date()
  const previewYear = isNaN(previewDate.getTime()) ? new Date().getFullYear() : previewDate.getFullYear()
  const previewMonth = isNaN(previewDate.getTime()) ? new Date().getMonth() : previewDate.getMonth()
  const planPrice = getPlanPriceSync(
    pricingData,
    parseInt(formData.frequency),
    formData.schedule,
    previewYear,
    previewMonth
  )
  const transportPrice = formData.hasTransport && formData.distanceRange
    ? getTransportPriceSync(
        transportPricingData,
        parseInt(formData.frequency),
        formData.distanceRange,
        previewYear,
        previewMonth
      )
    : { priceNet: 0, priceGross: 0 }
  const estimatedTotalGross = planPrice.priceGross + transportPrice.priceGross

  // Prorrateo del primer mes según la fecha de inicio (misma lógica que la calculadora de planes).
  const firstMonth = (() => {
    if (!formData.startDate) return null
    const start = new Date(`${formData.startDate}T00:00:00`)
    if (isNaN(start.getTime())) return null
    return calculateMonthProration({
      year: start.getFullYear(),
      month: start.getMonth(),
      startDate: formData.startDate,
      assignedDays: formData.assignedDays,
      frequency: parseInt(formData.frequency),
      monthlyAttendanceGross: planPrice.priceGross,
      monthlyTransportGross: transportPrice.priceGross
    })
  })()

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

                {/* Avatar upload */}
                <div className="flex items-center gap-4 mb-4">
                  <div className="relative group/avatar flex-shrink-0">
                    {avatarPreview ? (
                      <img
                        src={avatarPreview}
                        alt="Preview"
                        className="w-20 h-20 rounded-full object-cover border-2 border-gray-200"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gray-200 to-gray-300 flex items-center justify-center border-2 border-gray-200">
                        <span className="text-2xl text-gray-400 font-light">
                          {formData.firstName?.[0] || '?'}{formData.lastName?.[0] || '?'}
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer transition-colors">
                      {avatarPreview ? 'Cambiar foto' : 'Subir foto'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          setAvatarFile(file)
                          setAvatarPreview(URL.createObjectURL(file))
                        }}
                      />
                    </label>
                    {avatarPreview && (
                      <button
                        type="button"
                        onClick={() => {
                          setAvatarFile(null)
                          setAvatarPreview(null)
                        }}
                        className="ml-2 text-sm text-red-500 hover:text-red-600"
                      >
                        Eliminar
                      </button>
                    )}
                    <p className="text-xs text-gray-400 mt-1">JPG, PNG o WebP. Máx 5MB.</p>
                  </div>
                </div>

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
                  <Select
                    label="Tipo de documento"
                    value={formData.documentType}
                    onChange={(e) => updateField('documentType', e.target.value)}
                    options={DOCUMENT_TYPE_OPTIONS}
                  />
                  <Input
                    label="Número de documento"
                    value={formData.documentNumber}
                    onChange={(e) => updateField('documentNumber', e.target.value)}
                    error={errors.documentNumber}
                    placeholder="1.234.567-8"
                  />
                  <Input
                    label="Responsable de transferencia"
                    value={formData.transferResponsible}
                    onChange={(e) => updateField('transferResponsible', e.target.value)}
                    placeholder="Nombre de quien realiza la transferencia"
                    className="col-span-2"
                  />
                  <Select
                    label="Estado civil"
                    value={formData.maritalStatus}
                    onChange={(e) => updateField('maritalStatus', e.target.value)}
                    options={[{ value: '', label: 'Seleccionar...' }, ...MARITAL_STATUS_OPTIONS]}
                  />
                  <Select
                    label="Tipo de domicilio"
                    value={formData.residenceType}
                    onChange={(e) => updateField('residenceType', e.target.value)}
                    options={[{ value: '', label: 'Seleccionar...' }, ...RESIDENCE_TYPE_OPTIONS]}
                  />
                  <Input
                    label="Con quién vive"
                    value={formData.livesWith}
                    onChange={(e) => updateField('livesWith', e.target.value)}
                    placeholder="Ej: Residencial Huertas"
                    className="col-span-2"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-medium text-gray-900">Contactos de emergencia</h3>
                  <button
                    type="button"
                    onClick={addContact}
                    disabled={formData.emergencyContacts.length >= MAX_EMERGENCY_CONTACTS}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" />
                    Agregar contacto
                  </button>
                </div>
                <div className="space-y-3">
                  {formData.emergencyContacts.map((contact, index) => (
                    <div key={index} className="relative grid grid-cols-3 gap-4 rounded-xl border border-gray-200 p-4">
                      <Input
                        label="Nombre"
                        value={contact.name}
                        onChange={(e) => updateContact(index, 'name', e.target.value)}
                        error={errors[`ec_${index}_name`]}
                        placeholder="Carlos González"
                      />
                      <Input
                        label="Vínculo"
                        value={contact.relationship}
                        onChange={(e) => updateContact(index, 'relationship', e.target.value)}
                        placeholder="Hijo/a"
                      />
                      <Input
                        label="Teléfono"
                        value={contact.phone}
                        onChange={(e) => updateContact(index, 'phone', e.target.value)}
                        error={errors[`ec_${index}_phone`]}
                        placeholder="+54 11 8765-4321"
                      />
                      {formData.emergencyContacts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeContact(index)}
                          className="absolute top-2 right-2 p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                          title="Eliminar contacto"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-2">Mínimo 1, máximo {MAX_EMERGENCY_CONTACTS} contactos.</p>
              </div>

              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Dirección</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Dirección"
                    value={formData.street}
                    onChange={(e) => updateField('street', e.target.value)}
                    onBlur={handleStreetBlur}
                    error={errors.street}
                    placeholder="18 de Julio 1234, Montevideo"
                    className="col-span-2"
                  />
                  <div className="col-span-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowLocationModal(true)}
                      disabled={!formData.street || formData.street.trim().length < 5}
                      className="inline-flex items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <MapPin className="h-4 w-4" />
                      {formData.latitude != null ? 'Ajustar ubicación en el mapa' : 'Confirmar ubicación en el mapa'}
                    </button>
                    {geocoding ? (
                      <span className="text-xs text-gray-400">Calculando ubicación…</span>
                    ) : formData.latitude != null && (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700">
                        <Check className="h-3.5 w-3.5" />
                        Ubicación confirmada
                        {formData.distanceRange ? ` · ${DISTANCE_LABELS[formData.distanceRange]}` : ''}
                      </span>
                    )}
                  </div>
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
                  <Select
                    label="Distancia al club"
                    value={formData.distanceRange}
                    onChange={(e) => updateField('distanceRange', e.target.value)}
                    options={[
                      { value: '', label: 'Sin definir' },
                      { value: '0_to_2km', label: '0 a 2 km' },
                      { value: '2_to_5km', label: '2 a 5 km' },
                      { value: '5_to_10km', label: '5 a 10 km' }
                    ]}
                    className="col-span-2"
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
              {isEditMode && planFloorMonth && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Vigente desde
                  </label>
                  <select
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    value={planEffectiveFrom}
                    onChange={e => setPlanEffectiveFrom(e.target.value)}
                  >
                    {buildEffectiveMonthOptions(planFloorMonth).map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-500">
                    Los cambios de plan aplican desde este mes en adelante. Los meses anteriores no se modifican.
                  </p>
                </div>
              )}
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

              <button
                type="button"
                role="switch"
                aria-checked={formData.hasTransport}
                aria-label="Incluir transporte"
                onClick={() => updateField('hasTransport', !formData.hasTransport)}
                className={`w-full text-left rounded-2xl border p-4 transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 ${
                  formData.hasTransport
                    ? 'border-emerald-300 bg-emerald-50/60 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition-colors duration-200 ${
                    formData.hasTransport ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
                  }`}>
                    <Bus className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900">Transporte puerta a puerta</p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      El club retira y trae al cliente. Se factura aparte, según la distancia.
                    </p>
                  </div>
                  {/* toggle visual (the card itself is the switch control) */}
                  <span className={`relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors duration-200 ${
                    formData.hasTransport ? 'bg-emerald-500' : 'bg-gray-300'
                  }`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
                      formData.hasTransport ? 'translate-x-6' : 'translate-x-1'
                    }`} />
                  </span>
                </div>

                {/* revealed context when transport is on */}
                <div className={`grid transition-all duration-200 ${
                  formData.hasTransport ? 'mt-3 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}>
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-white/70 px-3 py-2 text-xs">
                      {formData.distanceRange ? (
                        <>
                          <Check className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
                          <span className="font-medium text-emerald-800">{DISTANCE_LABELS[formData.distanceRange]}</span>
                          {hasAccess('billing') && (
                            <>
                              <span className="text-gray-300">·</span>
                              <span className="text-gray-600">
                                {transportPrice.priceGross > 0
                                  ? `${formatCurrency(transportPrice.priceGross)} / mes aprox.`
                                  : 'precio no configurado'}
                              </span>
                            </>
                          )}
                        </>
                      ) : (
                        <span className="text-amber-700">Definí la distancia al club en el paso 1 para calcular el costo.</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>

              {/* Tipo de cliente (solo admin+) */}
              {hasAccess('billing') && (
                <div className="rounded-2xl border border-gray-200 bg-white p-4">
                  <p className="text-sm font-medium text-gray-700 mb-2">Tipo de cliente</p>
                  <div className="flex gap-2">
                    {CLIENT_TYPES.map((type) => {
                      const meta = CLIENT_TYPE_META[type]
                      const active = formData.clientType === type
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => updateField('clientType', type)}
                          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${active ? 'border-transparent' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
                          style={active ? { background: meta.bg, color: meta.color, borderColor: meta.color } : undefined}
                        >
                          {meta.glyph && <span aria-hidden>{meta.glyph}</span>}
                          {meta.label}
                        </button>
                      )
                    })}
                  </div>
                  {isNonBillableType(formData.clientType) && (
                    <p className="mt-2 text-xs text-gray-500">
                      Participa de la operativa (transporte, grupos, asistencia) pero no genera facturas ni impacta el dashboard financiero ni las métricas comerciales.
                    </p>
                  )}
                </div>
              )}

              {/* Price preview */}
              {hasAccess('billing') && !isNonBillableType(formData.clientType) && (
              <div className="bg-indigo-50 rounded-lg p-4 space-y-2">
                <p className="text-sm text-indigo-700">Precio mensual estimado</p>
                <p className="text-2xl font-bold text-indigo-900">
                  {formatCurrency(estimatedTotalGross)}
                </p>
                <div className="text-xs text-indigo-700 space-y-0.5">
                  <p>Mensualidad: {formatCurrency(planPrice.priceGross)}</p>
                  {formData.hasTransport && (
                    <p>
                      Transporte:{' '}
                      {transportPrice.priceGross > 0
                        ? formatCurrency(transportPrice.priceGross)
                        : '— (definir distancia)'}
                    </p>
                  )}
                </div>
                <p className="text-xs text-indigo-600 mt-1">
                  {formData.frequency}x/semana · {SCHEDULE_OPTIONS.find(s => s.value === formData.schedule)?.label}
                  {formData.hasTransport && ' · Transporte'}
                </p>

                {firstMonth?.prorated && (
                  <div className="pt-2 mt-2 border-t border-indigo-200">
                    <p className="text-sm text-indigo-700">Primer mes ({firstMonth.label}) · prorrateado</p>
                    <p className="text-xl font-bold text-indigo-900">{formatCurrency(firstMonth.total)}</p>
                    <p className="text-xs text-indigo-600 mt-0.5">
                      {firstMonth.billed} de {firstMonth.daysPerMonth} días desde el inicio
                      {formData.hasTransport && transportPrice.priceGross > 0 && ` · transporte ${formatCurrency(firstMonth.transport)}`}
                    </p>
                  </div>
                )}
              </div>
              )}
            </div>
          )}

          {/* Step 3: Información médica */}
          {currentStep === 3 && (
            <div className="space-y-8">
              {/* 1. Servicio de salud */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Servicio de salud</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Servicio de emergencia"
                    value={formData.healthEmergencyService}
                    onChange={(e) => updateField('healthEmergencyService', e.target.value)}
                    placeholder="Ej: SEMM, UCM..."
                  />
                  <Input
                    label="Prestador de salud"
                    value={formData.healthProvider}
                    onChange={(e) => updateField('healthProvider', e.target.value)}
                    placeholder="Ej: ASSE, mutualista..."
                  />
                  <Textarea
                    label="Notas generales"
                    value={formData.healthNotes}
                    onChange={(e) => updateField('healthNotes', e.target.value)}
                    rows={2}
                    className="col-span-2"
                  />
                </div>
              </div>

              {/* 2. Tratamiento farmacológico */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Tratamiento farmacológico</h3>
                <RepeatableRows
                  value={formData.medications}
                  onChange={(v) => updateField('medications', v)}
                  addLabel="Agregar medicamento"
                  emptyRow={{ name: '', schedule: '', dose: '', indicatedFor: '' }}
                  fields={[
                    { key: 'name', label: 'Nombre' },
                    { key: 'schedule', label: 'Horario' },
                    { key: 'dose', label: 'Dosis' },
                    { key: 'indicatedFor', label: 'Indicado para' }
                  ]}
                />
                <Textarea
                  label="Notas generales"
                  value={formData.medicationNotes}
                  onChange={(e) => updateField('medicationNotes', e.target.value)}
                  rows={2}
                  className="mt-4"
                />
              </div>

              {/* 3. Antecedentes */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Antecedentes</h3>
                <div className="space-y-2">
                  {MEDICAL_HISTORY_CONDITIONS.map(c => {
                    const active = Boolean(historyByCondition[c.value])
                    return (
                      <div key={c.value} className="flex flex-col gap-1 py-1">
                        <Checkbox
                          label={c.label}
                          checked={active}
                          onChange={(e) => toggleCondition(c.value, e.target.checked)}
                        />
                        {active && (
                          <Input
                            placeholder="Comentario (opcional)"
                            value={historyByCondition[c.value].comment || ''}
                            onChange={(e) => setConditionComment(c.value, e.target.value)}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
                <Textarea
                  label="Notas generales"
                  value={formData.historyNotes}
                  onChange={(e) => updateField('historyNotes', e.target.value)}
                  rows={2}
                  className="mt-4"
                />
              </div>

              {/* 4. Diagnóstico */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Diagnóstico</h3>
                <RepeatableRows
                  value={formData.diagnoses}
                  onChange={(v) => updateField('diagnoses', v)}
                  addLabel="Agregar diagnóstico"
                  emptyRow={{ diagnosisType: '', behaviorDisorder: '' }}
                  fields={[
                    { key: 'diagnosisType', label: 'Tipo', type: 'select', options: DIAGNOSIS_TYPE_OPTIONS },
                    { key: 'behaviorDisorder', label: 'Tipo y trastorno de comportamiento' }
                  ]}
                />
              </div>

              {/* 5. Historia de vida */}
              <div>
                <h3 className="text-lg font-medium text-gray-900 mb-4">Historia de vida</h3>
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Nivel educativo"
                    value={formData.educationLevel}
                    onChange={(e) => updateField('educationLevel', e.target.value)}
                  />
                  <Input
                    label="Trabajo / profesión"
                    value={formData.occupation}
                    onChange={(e) => updateField('occupation', e.target.value)}
                  />
                  <Textarea
                    label="Intereses significativos (actuales y previos)"
                    value={formData.significantInterests}
                    onChange={(e) => updateField('significantInterests', e.target.value)}
                    rows={2}
                    className="col-span-2"
                  />
                  <Textarea
                    label="Vínculos significativos"
                    value={formData.significantBonds}
                    onChange={(e) => updateField('significantBonds', e.target.value)}
                    rows={2}
                    className="col-span-2"
                  />
                  <Textarea
                    label="Gustos musicales"
                    value={formData.musicTaste}
                    onChange={(e) => updateField('musicTaste', e.target.value)}
                    rows={2}
                  />
                  <Textarea
                    label="Comidas favoritas"
                    value={formData.favoriteFoods}
                    onChange={(e) => updateField('favoriteFoods', e.target.value)}
                    rows={2}
                  />
                  <Select
                    label="Carácter"
                    value={formData.character}
                    onChange={(e) => updateField('character', e.target.value)}
                    options={[{ value: '', label: 'Seleccionar...' }, ...CHARACTER_OPTIONS]}
                    className="col-span-2"
                  />
                  <Textarea
                    label="Recursos personales"
                    value={formData.personalResources}
                    onChange={(e) => updateField('personalResources', e.target.value)}
                    rows={2}
                    className="col-span-2"
                  />
                  <Textarea
                    label="Vulnerabilidad, miedos o preocupaciones actuales"
                    value={formData.vulnerabilities}
                    onChange={(e) => updateField('vulnerabilities', e.target.value)}
                    rows={2}
                    className="col-span-2"
                  />
                </div>
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

      <LocationPickerModal
        isOpen={showLocationModal}
        address={formData.street}
        initialCoords={formData.latitude != null && formData.longitude != null
          ? { lat: formData.latitude, lng: formData.longitude }
          : null}
        onClose={() => setShowLocationModal(false)}
        onConfirm={(res) => {
          updateField('latitude', res.lat)
          updateField('longitude', res.lng)
          if (res.distanceRange) updateField('distanceRange', res.distanceRange)
          // Coords now match the current street — keep them across a later blur.
          lastGeocodedStreetRef.current = formData.street?.trim() || ''
          setShowLocationModal(false)
        }}
      />
    </div>
  )
}
