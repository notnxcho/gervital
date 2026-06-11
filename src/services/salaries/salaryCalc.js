// Pure salary cost calculations (Uruguayan labor model).
// asOf is injected (no internal Date.now) so results are deterministic and testable.

export const VACATION_DAYS = 20

/**
 * Current salary = adjustment with the latest effectiveDate (tie-break by createdAt).
 * @param {Array<{nominal:number, liquido:number, effectiveDate:string, createdAt?:string}>} adjustments
 * @returns {{nominal:number, liquido:number, effectiveDate:string}|null}
 */
export function currentSalary(adjustments) {
  if (!adjustments || adjustments.length === 0) return null
  const sorted = [...adjustments].sort((a, b) => {
    if (a.effectiveDate !== b.effectiveDate) return a.effectiveDate < b.effectiveDate ? 1 : -1
    const aCA = a.createdAt || '', bCA = b.createdAt || ''
    if (aCA !== bCA) return aCA < bCA ? 1 : -1
    return 0
  })
  const top = sorted[0]
  return { nominal: Number(top.nominal), liquido: Number(top.liquido), effectiveDate: top.effectiveDate }
}

// Aguinaldo (SAC): 1/12 del nominal anual = un mes de nominal.
export function aguinaldoAnual(nominal) {
  return Number(nominal) || 0
}

// Salario vacacional: (liquido / 30) * 20 dias (base liquido, segun ley).
export function salarioVacacionalAnual(liquido) {
  return ((Number(liquido) || 0) / 30) * VACATION_DAYS
}

// Suma de extraordinarios del empleado en los ultimos 12 meses respecto a asOf.
export function extraordinarios12m(extraCosts, asOf) {
  if (!extraCosts || extraCosts.length === 0) return 0
  const ref = asOf ? new Date(asOf) : new Date()
  const cutoff = new Date(ref)
  cutoff.setFullYear(cutoff.getFullYear() - 1)
  return extraCosts
    .filter(x => {
      const d = new Date(x.date)
      return d > cutoff && d <= ref
    })
    .reduce((sum, x) => sum + (Number(x.amount) || 0), 0)
}

// Costo anual = nominal*12 + aguinaldo + salario vacacional + extraordinarios 12m.
export function costoAnual(args, asOf) {
  const { nominal, liquido, extraCosts } = args || {}
  return (Number(nominal) || 0) * 12
    + aguinaldoAnual(nominal)
    + salarioVacacionalAnual(liquido)
    + extraordinarios12m(extraCosts, asOf)
}

export function costoAnualMensualizado(args, asOf) {
  return costoAnual(args, asOf) / 12
}

// Proyeccion: aplica el % semestral compuesto sobre N semestres (uso futuro en analisis).
export function proyectarNominal(nominal, pct, semestres) {
  return (Number(nominal) || 0) * Math.pow(1 + (Number(pct) || 0) / 100, semestres)
}
