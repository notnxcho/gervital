/**
 * Transform client data from frontend format to database format
 * @param {object} clientData - Frontend client object
 * @returns {object} Database-ready parameters for create_client_full
 */
export function transformClientToDb(clientData) {
  return {
    p_first_name: clientData.firstName,
    p_last_name: clientData.lastName,
    p_email: clientData.email || null,
    p_phone: clientData.phone || null,
    p_birth_date: clientData.birthDate || null,
    p_cognitive_level: clientData.cognitiveLevel || null,
    p_start_date: clientData.startDate || null,
    // Plan
    p_plan_frequency: clientData.plan?.frequency || null,
    p_plan_schedule: clientData.plan?.schedule || null,
    p_plan_has_transport: clientData.plan?.hasTransport || false,
    p_plan_assigned_days: clientData.plan?.assignedDays || [],
    // Emergency contact
    p_ec_name: clientData.emergencyContact?.name || null,
    p_ec_relationship: clientData.emergencyContact?.relationship || null,
    p_ec_phone: clientData.emergencyContact?.phone || null,
    // Address
    p_addr_street: clientData.address?.street || null,
    p_addr_access_notes: clientData.address?.accessNotes || null,
    p_addr_doorbell: clientData.address?.doorbell || null,
    p_addr_concierge: clientData.address?.concierge || null,
    // Medical info
    p_med_dietary: clientData.medicalInfo?.dietaryRestrictions || null,
    p_med_medical: clientData.medicalInfo?.medicalRestrictions || null,
    p_med_mobility: clientData.medicalInfo?.mobilityRestrictions || null,
    p_med_medication: clientData.medicalInfo?.medication || null,
    p_med_medication_schedule: clientData.medicalInfo?.medicationSchedule || null,
    p_med_notes: clientData.medicalInfo?.notes || null
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
    address: dbClient.address || {
      street: '',
      accessNotes: '',
      doorbell: '',
      concierge: ''
    },
    medicalInfo: dbClient.medicalInfo || {
      dietaryRestrictions: '',
      medicalRestrictions: '',
      mobilityRestrictions: '',
      medication: '',
      medicationSchedule: '',
      notes: ''
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
  if (updateData.firstName !== undefined) params.p_first_name = updateData.firstName
  if (updateData.lastName !== undefined) params.p_last_name = updateData.lastName
  if (updateData.email !== undefined) params.p_email = updateData.email
  if (updateData.phone !== undefined) params.p_phone = updateData.phone
  if (updateData.birthDate !== undefined) params.p_birth_date = updateData.birthDate
  if (updateData.cognitiveLevel !== undefined) params.p_cognitive_level = updateData.cognitiveLevel
  if (updateData.startDate !== undefined) params.p_start_date = updateData.startDate

  // Plan
  if (updateData.plan) {
    if (updateData.plan.frequency !== undefined) params.p_plan_frequency = updateData.plan.frequency
    if (updateData.plan.schedule !== undefined) params.p_plan_schedule = updateData.plan.schedule
    if (updateData.plan.hasTransport !== undefined) params.p_plan_has_transport = updateData.plan.hasTransport
    if (updateData.plan.assignedDays !== undefined) params.p_plan_assigned_days = updateData.plan.assignedDays
  }

  // Emergency contact
  if (updateData.emergencyContact) {
    if (updateData.emergencyContact.name !== undefined) params.p_ec_name = updateData.emergencyContact.name
    if (updateData.emergencyContact.relationship !== undefined) params.p_ec_relationship = updateData.emergencyContact.relationship
    if (updateData.emergencyContact.phone !== undefined) params.p_ec_phone = updateData.emergencyContact.phone
  }

  // Address
  if (updateData.address) {
    if (updateData.address.street !== undefined) params.p_addr_street = updateData.address.street
    if (updateData.address.accessNotes !== undefined) params.p_addr_access_notes = updateData.address.accessNotes
    if (updateData.address.doorbell !== undefined) params.p_addr_doorbell = updateData.address.doorbell
    if (updateData.address.concierge !== undefined) params.p_addr_concierge = updateData.address.concierge
  }

  // Medical info
  if (updateData.medicalInfo) {
    if (updateData.medicalInfo.dietaryRestrictions !== undefined) params.p_med_dietary = updateData.medicalInfo.dietaryRestrictions
    if (updateData.medicalInfo.medicalRestrictions !== undefined) params.p_med_medical = updateData.medicalInfo.medicalRestrictions
    if (updateData.medicalInfo.mobilityRestrictions !== undefined) params.p_med_mobility = updateData.medicalInfo.mobilityRestrictions
    if (updateData.medicalInfo.medication !== undefined) params.p_med_medication = updateData.medicalInfo.medication
    if (updateData.medicalInfo.medicationSchedule !== undefined) params.p_med_medication_schedule = updateData.medicalInfo.medicationSchedule
    if (updateData.medicalInfo.notes !== undefined) params.p_med_notes = updateData.medicalInfo.notes
  }

  return params
}
