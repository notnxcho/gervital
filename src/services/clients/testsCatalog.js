// Catálogo de tests clínicos. Fuente de verdad de definición y scoring (frontend).
// Sumar un test = agregar una entrada acá (sin migración de DB).
export const TESTS_CATALOG = [
  {
    id: 'lawton_brody',
    name: 'Lawton & Brody (IADL)',
    domain: 'Funcional — actividades instrumentales',
    defaultOnCreate: true,
    fields: [
      { name: 'telefono', label: 'Uso del teléfono', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'usa_iniciativa', label: 'Utiliza el teléfono por iniciativa propia, busca y marca números', score: 1 },
        { value: 'marca_conocidos', label: 'Marca algunos números bien conocidos', score: 1 },
        { value: 'contesta_no_marca', label: 'Contesta pero no marca', score: 1 },
        { value: 'no_usa', label: 'No usa el teléfono en absoluto', score: 0 }
      ]},
      { name: 'compras', label: 'Hacer compras', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Realiza todas las compras necesarias de forma independiente', score: 1 },
        { value: 'pequenas', label: 'Compra independientemente pequeñas cosas', score: 0 },
        { value: 'acompanado', label: 'Necesita ir acompañado', score: 0 },
        { value: 'incapaz', label: 'Totalmente incapaz de comprar', score: 0 }
      ]},
      { name: 'cocina', label: 'Preparación de la comida', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'planea_prepara', label: 'Planea, prepara y sirve comidas adecuadas de forma independiente', score: 1 },
        { value: 'prepara_con_ingredientes', label: 'Prepara si le dan los ingredientes', score: 0 },
        { value: 'calienta', label: 'Calienta y sirve pero no mantiene dieta adecuada', score: 0 },
        { value: 'necesita_preparada', label: 'Necesita que le preparen la comida', score: 0 }
      ]},
      { name: 'tareas_hogar', label: 'Cuidado de la casa', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'solo_o_ayuda_tareas_pesadas', label: 'Mantiene la casa solo o con ayuda ocasional para tareas pesadas', score: 1 },
        { value: 'tareas_ligeras', label: 'Realiza tareas ligeras (fregar, hacer camas)', score: 1 },
        { value: 'ligeras_sin_nivel', label: 'Tareas ligeras pero no mantiene nivel de limpieza adecuado', score: 1 },
        { value: 'ayuda_todas', label: 'Necesita ayuda en todas las tareas', score: 1 },
        { value: 'no_participa', label: 'No participa en ninguna tarea', score: 0 }
      ]},
      { name: 'lavado_ropa', label: 'Lavado de la ropa', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Lava toda su ropa', score: 1 },
        { value: 'pequenas_prendas', label: 'Lava pequeñas prendas', score: 1 },
        { value: 'otros', label: 'Todo el lavado lo realizan otros', score: 0 }
      ]},
      { name: 'transporte', label: 'Uso de medios de transporte', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'publico_o_conduce', label: 'Viaja solo (transporte público o conduce)', score: 1 },
        { value: 'taxi_no_bus', label: 'Viaja en taxi pero no usa otro transporte', score: 1 },
        { value: 'publico_acompanado', label: 'Viaja en transporte público acompañado', score: 1 },
        { value: 'taxi_auto_acompanado', label: 'Solo taxi/auto con ayuda de otro', score: 0 },
        { value: 'no_viaja', label: 'No viaja', score: 0 }
      ]},
      { name: 'medicacion', label: 'Responsabilidad sobre la medicación', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'responsable', label: 'Toma la medicación a la hora y dosis correctas de forma independiente', score: 1 },
        { value: 'preparada', label: 'La toma si se la preparan con anticipación en dosis separadas', score: 0 },
        { value: 'incapaz', label: 'No es capaz de administrarse la medicación', score: 0 }
      ]},
      { name: 'finanzas', label: 'Manejo de asuntos económicos', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Maneja los asuntos financieros con independencia', score: 1 },
        { value: 'compras_diarias', label: 'Maneja gastos diarios pero necesita ayuda con banca/grandes compras', score: 1 },
        { value: 'incapaz', label: 'Incapaz de manejar dinero', score: 0 }
      ]}
    ],
    scoring: {
      producesScore: true,
      autoCalculated: true,
      method: 'Suma de los 8 ítems (cada ítem 0 o 1).',
      range: '0-8',
      scoreVersion: 'lawton_unisex_8',
      interpretation: [
        { min: 8, max: 8, label: 'Independiente (mujer)' },
        { min: 6, max: 7, label: 'Dependencia leve' },
        { min: 4, max: 5, label: 'Dependencia moderada' },
        { min: 2, max: 3, label: 'Dependencia severa' },
        { min: 0, max: 1, label: 'Dependencia total' }
      ]
    }
  },
  {
    id: 'barthel',
    name: 'Índice de Barthel (ABVD)',
    domain: 'Funcional — actividades básicas de la vida diaria',
    defaultOnCreate: true,
    fields: [
      { name: 'comer', label: 'Comer', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Independiente', score: 10 },
        { value: 'ayuda', label: 'Necesita ayuda (cortar, untar)', score: 5 },
        { value: 'dependiente', label: 'Dependiente', score: 0 }
      ]},
      { name: 'lavarse', label: 'Lavarse / bañarse', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Independiente', score: 5 },
        { value: 'dependiente', label: 'Dependiente', score: 0 }
      ]},
      { name: 'vestirse', label: 'Vestirse', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Independiente', score: 10 },
        { value: 'ayuda', label: 'Necesita ayuda', score: 5 },
        { value: 'dependiente', label: 'Dependiente', score: 0 }
      ]},
      { name: 'arreglarse', label: 'Arreglarse / aseo personal', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Independiente (afeitado, peinado, dientes)', score: 5 },
        { value: 'dependiente', label: 'Dependiente', score: 0 }
      ]},
      { name: 'deposiciones', label: 'Deposiciones (continencia fecal)', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'continente', label: 'Continente', score: 10 },
        { value: 'ocasional', label: 'Accidente ocasional', score: 5 },
        { value: 'incontinente', label: 'Incontinente', score: 0 }
      ]},
      { name: 'miccion', label: 'Micción (continencia urinaria)', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'continente', label: 'Continente', score: 10 },
        { value: 'ocasional', label: 'Accidente ocasional', score: 5 },
        { value: 'incontinente', label: 'Incontinente / sonda incapaz de manejar', score: 0 }
      ]},
      { name: 'uso_retrete', label: 'Uso del retrete', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Independiente', score: 10 },
        { value: 'ayuda', label: 'Necesita ayuda', score: 5 },
        { value: 'dependiente', label: 'Dependiente', score: 0 }
      ]},
      { name: 'traslado', label: 'Traslado sillón / cama', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Independiente', score: 15 },
        { value: 'minima_ayuda', label: 'Mínima ayuda física o supervisión', score: 10 },
        { value: 'gran_ayuda', label: 'Gran ayuda (una persona entrenada), se sienta', score: 5 },
        { value: 'dependiente', label: 'Dependiente, no se mantiene sentado', score: 0 }
      ]},
      { name: 'deambulacion', label: 'Deambulación', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Independiente 50 m (puede usar bastón)', score: 15 },
        { value: 'ayuda', label: 'Necesita ayuda/supervisión de una persona 50 m', score: 10 },
        { value: 'silla_ruedas', label: 'Independiente en silla de ruedas 50 m', score: 5 },
        { value: 'dependiente', label: 'Dependiente', score: 0 }
      ]},
      { name: 'escaleras', label: 'Subir y bajar escaleras', type: 'enum', selection: 'single', scored: true, options: [
        { value: 'independiente', label: 'Independiente', score: 10 },
        { value: 'ayuda', label: 'Necesita ayuda física o supervisión', score: 5 },
        { value: 'dependiente', label: 'Dependiente', score: 0 }
      ]}
    ],
    scoring: {
      producesScore: true,
      autoCalculated: true,
      method: 'Suma ponderada de los 10 ítems (pesos 0/5/10/15).',
      range: '0-100',
      scoreVersion: 'barthel_original_10',
      interpretation: [
        { min: 100, max: 100, label: 'Independiente' },
        { min: 91, max: 99, label: 'Dependencia leve' },
        { min: 61, max: 90, label: 'Dependencia moderada' },
        { min: 21, max: 60, label: 'Dependencia severa' },
        { min: 0, max: 20, label: 'Dependencia total' }
      ]
    }
  }
]

export function getTestById(testId) {
  return TESTS_CATALOG.find(t => t.id === testId)
}

// Máximo puntaje posible del test (para mostrar "X/máx").
export function getMaxScore(test) {
  return test.fields
    .filter(f => f.scored)
    .reduce((sum, f) => sum + Math.max(...f.options.map(o => o.score)), 0)
}
