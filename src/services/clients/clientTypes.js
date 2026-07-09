// Tipos de cliente. 'regular' factura normalmente; 'charity' (beneficencia) y
// 'trial' (a prueba) son operativos: participan de la operativa (transporte,
// grupos, asistencia) pero no generan facturacion ni impactan las metricas de
// dinero. Charity y trial se comportan igual: solo difieren en la etiqueta visual.
export const CLIENT_TYPES = ['regular', 'charity', 'trial']

// glyph: se usa como chip monocromatico en la lista (hereda `color`).
// El selector VS15 (︎) fuerza presentacion de texto para que el rayo tome el color.
export const CLIENT_TYPE_META = {
  regular: { value: 'regular', label: 'Normal', glyph: null, color: '#64748b', bg: '#f1f5f9' },
  charity: { value: 'charity', label: 'Beneficencia', glyph: '♥', color: '#7c3aed', bg: '#ede9fe' },
  trial: { value: 'trial', label: 'A prueba', glyph: '⚡︎', color: '#ea580c', bg: '#ffedd5' }
}

// charity y trial no facturan ni cuentan para agregadores/metricas de dinero.
export const isNonBillableType = (type) => type === 'charity' || type === 'trial'
