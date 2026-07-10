// Default de montos a facturar por línea (asistencia / transporte).
//
// Regla de negocio: el monto a facturar por defecto debe ser igual al COBRADO.
// Si el mes fue cobrado, se prepopula lo cobrado (paidAmount) prorrateado entre
// las dos líneas según la proporción del cálculo en vivo. Si aún no se cobró,
// se usa el cálculo en vivo.
//
// El prorrateo mantiene el total EXACTO: se redondea transporte y asistencia
// absorbe el resto, así asistencia + transporte === redondeo(cobrado).
//
// NOTA: esta misma lógica está espejada inline en la edge function
// supabase/functions/biller/index.ts (handler emit_invoice), que no puede
// importar desde src/. Si cambiás la fórmula acá, actualizala allá también.
export function prorateInvoiceLines({ paymentStatus, paidAmount, liveAttGross, liveTransGross, hasTransport }) {
  const attEff = Number(liveAttGross) || 0
  const transEff = hasTransport ? (Number(liveTransGross) || 0) : 0
  const liveTotal = attEff + transEff

  const paid = paymentStatus === 'paid' && paidAmount != null ? Number(paidAmount) : null

  // Mes no cobrado → default = cálculo en vivo
  if (paid == null) {
    return { attGross: Math.round(attEff), transGross: Math.round(transEff) }
  }

  // Mes cobrado → default = lo cobrado
  if (paid <= 0) return { attGross: 0, transGross: 0 }
  if (liveTotal <= 0) return { attGross: Math.round(paid), transGross: 0 }

  const transGross = transEff > 0 ? Math.round((paid * transEff) / liveTotal) : 0
  const attGross = Math.round(paid) - transGross
  return { attGross, transGross }
}

// Monto total a facturar de un cliente/mes: el COBRADO si el mes ya se cobró
// (aunque haya diferido del cálculo), si no el cálculo en vivo. Es la versión
// "un solo número" de prorateInvoiceLines, para listados (panel de cobranza, bulk).
export function billableTotal({ paymentStatus, paidAmount, liveAmount }) {
  if (paymentStatus === 'paid' && paidAmount != null) return Number(paidAmount)
  return Number(liveAmount) || 0
}
