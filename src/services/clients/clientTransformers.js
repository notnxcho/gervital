// Normaliza nombres: quita espacios sobrantes al inicio/fin y colapsa dobles.
// Evita que un espacio inicial rompa el orden alfabético.
const cleanName = (v) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v

/**
 * Transform client data from frontend format to database format
 * @param {object} clientData - Frontend client object
 * @returns {object} Database-ready parameters for create_client_full
 */
export function transformClientToDb(clientData) {
  return {
    p_first_name: cleanName(clientData.firstName),
    p_last_name: cleanName(clientData.lastName),
    p_email: clientData.email || null,
    p_phone: clientData.phone || null,
    p_birth_date: clientData.birthDate || null,
    p_cognitive_level: clientData.cognitiveLevel || null,
    p_start_date: clientData.startDate || null,
    p_document_type: clientData.documentType || 'ci',
    p_document_number: clientData.documentNumber || null,
    // Plan
    p_plan_frequency: clientData.plan?.frequency || null,
    p_plan_schedule: clientData.plan?.schedule || null,
    p_plan_has_transport: clientData.plan?.hasTransport || false,
    p_plan_assigned_days: clientData.plan?.assignedDays || [],
    // Emergency contacts (array, 1..5) + transfer responsible
    p_emergency_contacts: clientData.emergencyContacts || null,
    p_transfer_responsible: clientData.transferResponsible || null,
    // Address
    p_addr_street: clientData.address?.street || null,
    p_addr_access_notes: clientData.address?.accessNotes || null,
    p_addr_doorbell: clientData.address?.doorbell || null,
    p_addr_concierge: clientData.address?.concierge || null,
    p_addr_distance_range: clientData.address?.distanceRange || null,
    // Personal
    p_marital_status: clientData.maritalStatus || null,
    p_residence_type: clientData.residenceType || null,
    p_lives_with: clientData.livesWith || null,
    // Medical info (scalars)
    p_health_emergency_service: clientData.medicalInfo?.healthEmergencyService || null,
    p_health_provider: clientData.medicalInfo?.healthProvider || null,
    p_health_notes: clientData.medicalInfo?.healthNotes || null,
    p_medication_notes: clientData.medicalInfo?.medicationNotes || null,
    p_history_notes: clientData.medicalInfo?.historyNotes || null,
    p_education_level: clientData.medicalInfo?.educationLevel || null,
    p_occupation: clientData.medicalInfo?.occupation || null,
    p_significant_interests: clientData.medicalInfo?.significantInterests || null,
    p_significant_bonds: clientData.medicalInfo?.significantBonds || null,
    p_music_taste: clientData.medicalInfo?.musicTaste || null,
    p_favorite_foods: clientData.medicalInfo?.favoriteFoods || null,
    p_character: clientData.medicalInfo?.character || null,
    p_personal_resources: clientData.medicalInfo?.personalResources || null,
    p_vulnerabilities: clientData.medicalInfo?.vulnerabilities || null,
    // Medical collections (arrays -> jsonb)
    p_medications: clientData.medications || [],
    p_diagnoses: clientData.diagnoses || [],
    p_medical_history: clientData.medicalHistory || [],
    // Client type: regular | charity | trial (write is admin-gated server-side)
    p_client_type: clientData.clientType || 'regular'
  }
}

/**
 * Transform client data from database format to frontend format
 * The clients_full view already returns data in the correct format
 * This function is here for any additional transformations if needed
 * @param {object} dbClient - Database client object from clients_full view
 * @returns {object} Frontend-ready client object
 */
export function transformClientFromDb(dbClient) {
  // The view already handles the transformation
  // Just ensure dates are strings and handle nulls
  return {
    ...dbClient,
    birthDate: dbClient.birthDate ? String(dbClient.birthDate).split('T')[0] : null,
    startDate: dbClient.startDate ? String(dbClient.startDate).split('T')[0] : null,
    createdAt: dbClient.createdAt ? String(dbClient.createdAt).split('T')[0] : null,
    deletedAt: dbClient.deletedAt || null,
    deactivationDate: dbClient.deactivationDate ? String(dbClient.deactivationDate).split('T')[0] : null,
    deactivationReason: dbClient.deactivationReason || null,
    deactivationNotes: dbClient.deactivationNotes || null,
    clientType: dbClient.clientType || 'regular',
    // charity y trial no facturan ni cuentan para metricas de dinero
    isNonBillable: (dbClient.clientType || 'regular') !== 'regular',
    hasActiveDiscount: dbClient.hasActiveDiscount || false,
    recoveryDaysAvailable: dbClient.recoveryDaysAvailable || 0,
    plan: dbClient.plan || {
      frequency: 1,
      schedule: 'morning',
      hasTransport: false,
      assignedDays: []
    },
    emergencyContact: dbClient.emergencyContact || {
      name: '',
      relationship: '',
      phone: ''
    },
    emergencyContacts: dbClient.emergencyContacts || [],
    transferResponsible: dbClient.transferResponsible || '',
    address: dbClient.address || {
      street: '',
      accessNotes: '',
      doorbell: '',
      concierge: '',
      distanceRange: null
    },
    maritalStatus: dbClient.maritalStatus || '',
    residenceType: dbClient.residenceType || '',
    livesWith: dbClient.livesWith || '',
    medications: dbClient.medications || [],
    diagnoses: dbClient.diagnoses || [],
    medicalHistory: dbClient.medicalHistory || [],
    medicalInfo: dbClient.medicalInfo || {
      healthEmergencyService: '', healthProvider: '', healthNotes: '',
      medicationNotes: '', historyNotes: '',
      educationLevel: '', occupation: '', significantInterests: '', significantBonds: '',
      musicTaste: '', favoriteFoods: '', character: '', personalResources: '', vulnerabilities: ''
    }
  }
}

/**
 * Transform update data for the update_client_full function
 * Only includes fields that have values
 * @param {string} clientId
 * @param {object} updateData - Partial client data to update
 * @returns {object} Database-ready parameters
 */
export function transformUpdateToDb(clientId, updateData) {
  const params = {
    p_client_id: clientId
  }

  // Basic fields
  if (updateData.firstName !== undefined) params.p_first_name = cleanName(updateData.firstName)
  if (updateData.lastName !== undefined) params.p_last_name = cleanName(updateData.lastName)
  if (updateData.email !== undefined) params.p_email = updateData.email
  if (updateData.phone !== undefined) params.p_phone = updateData.phone
  if (updateData.birthDate !== undefined) params.p_birth_date = updateData.birthDate
  if (updateData.cognitiveLevel !== undefined) params.p_cognitive_level = updateData.cognitiveLevel
  if (updateData.startDate !== undefined) params.p_start_date = updateData.startDate
  if (updateData.documentType !== undefined) params.p_document_type = updateData.documentType
  if (updateData.documentNumber !== undefined) params.p_document_number = updateData.documentNumber
  if (updateData.clientType !== undefined) params.p_client_type = updateData.clientType

  // Emergency contacts (array, 1..5) + transfer responsible
  if (updateData.emergencyContacts !== undefined) params.p_emergency_contacts = updateData.emergencyContacts
  if (updateData.transferResponsible !== undefined) params.p_transfer_responsible = updateData.transferResponsible

  // Address
  if (updateData.address) {
    if (updateData.address.street !== undefined) params.p_addr_street = updateData.address.street
    if (updateData.address.accessNotes !== undefined) params.p_addr_access_notes = updateData.address.accessNotes
    if (updateData.address.doorbell !== undefined) params.p_addr_doorbell = updateData.address.doorbell
    if (updateData.address.concierge !== undefined) params.p_addr_concierge = updateData.address.concierge
    if (updateData.address.distanceRange !== undefined) params.p_addr_distance_range = updateData.address.distanceRange || null
  }

  // Personal
  if (updateData.maritalStatus !== undefined) params.p_marital_status = updateData.maritalStatus
  if (updateData.residenceType !== undefined) params.p_residence_type = updateData.residenceType
  if (updateData.livesWith !== undefined) params.p_lives_with = updateData.livesWith

  // Medical info (scalars)
  if (updateData.medicalInfo) {
    const m = updateData.medicalInfo
    if (m.healthEmergencyService !== undefined) params.p_health_emergency_service = m.healthEmergencyService
    if (m.healthProvider !== undefined) params.p_health_provider = m.healthProvider
    if (m.healthNotes !== undefined) params.p_health_notes = m.healthNotes
    if (m.medicationNotes !== undefined) params.p_medication_notes = m.medicationNotes
    if (m.historyNotes !== undefined) params.p_history_notes = m.historyNotes
    if (m.educationLevel !== undefined) params.p_education_level = m.educationLevel
    if (m.occupation !== undefined) params.p_occupation = m.occupation
    if (m.significantInterests !== undefined) params.p_significant_interests = m.significantInterests
    if (m.significantBonds !== undefined) params.p_significant_bonds = m.significantBonds
    if (m.musicTaste !== undefined) params.p_music_taste = m.musicTaste
    if (m.favoriteFoods !== undefined) params.p_favorite_foods = m.favoriteFoods
    if (m.character !== undefined) params.p_character = m.character
    if (m.personalResources !== undefined) params.p_personal_resources = m.personalResources
    if (m.vulnerabilities !== undefined) params.p_vulnerabilities = m.vulnerabilities
  }

  // Medical collections
  if (updateData.medications !== undefined) params.p_medications = updateData.medications
  if (updateData.diagnoses !== undefined) params.p_diagnoses = updateData.diagnoses
  if (updateData.medicalHistory !== undefined) params.p_medical_history = updateData.medicalHistory

  return params
}
