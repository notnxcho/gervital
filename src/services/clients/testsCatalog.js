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
  },
  {
    id: 'pfeiffer_spmsq',
    name: 'Cuestionario de Pfeiffer (SPMSQ)',
    domain: 'Cognitivo — cribado breve',
    defaultOnCreate: false,
    // Cada ítem se registra como respondido correctamente (true) o con error (false).
    // El puntaje cuenta ERRORES → cada ítem puntúa con scoredAnswer:false.
    fields: [
      { name: 'q1_fecha_hoy', label: '¿Qué día es hoy (día, mes, año)?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q2_dia_semana', label: '¿Qué día de la semana es?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q3_lugar', label: '¿Cuál es el nombre de este sitio/lugar?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q4_telefono_direccion', label: '¿Cuál es su número de teléfono? (o dirección)', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q5_edad', label: '¿Cuántos años tiene?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q6_fecha_nacimiento', label: '¿Cuándo nació?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q7_presidente_actual', label: '¿Quién es el presidente actual?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q8_presidente_anterior', label: '¿Quién fue el presidente anterior?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q9_apellido_madre', label: '¿Cuál era el primer apellido de su madre?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q10_resta_seriada', label: 'Reste de 3 en 3 desde 20', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'escolaridad', label: 'Nivel de escolaridad (no ajusta el puntaje)', type: 'enum', selection: 'single', scored: false, options: [
        { value: 'primaria_o_menos', label: 'Educación primaria o menos', score: 0 },
        { value: 'secundaria', label: 'Educación media', score: 0 },
        { value: 'superior', label: 'Educación superior a secundaria', score: 0 }
      ]}
    ],
    scoring: {
      producesScore: true,
      mode: 'auto',
      method: 'Cuenta de errores (respuestas incorrectas). El puntaje es el número de errores.',
      range: '0-10 errores',
      scoreVersion: 'pfeiffer_10',
      interpretation: [
        { min: 0, max: 2, label: 'Normal' },
        { min: 3, max: 4, label: 'Deterioro cognitivo leve' },
        { min: 5, max: 7, label: 'Deterioro cognitivo moderado' },
        { min: 8, max: 10, label: 'Deterioro cognitivo severo' }
      ]
    }
  },
  {
    id: 'test_reloj',
    name: 'Test del reloj',
    domain: 'Cognitivo — visuoconstructivo/ejecutivo',
    defaultOnCreate: false,
    fields: [
      { name: 'condicion', label: 'Condición de administración', type: 'enum', selection: 'single', scored: false, options: [
        { value: 'orden', label: 'A la orden (dibujar reloj con hora indicada)', score: 0 },
        { value: 'copia', label: 'A la copia', score: 0 }
      ]},
      { name: 'imagen_dibujo', label: 'Imagen del dibujo del paciente', type: 'image', scored: false },
      { name: 'puntaje_manual', label: 'Puntaje asignado por el clínico', type: 'number', scored: false, min: 0, max: 10 },
      { name: 'sistema_puntuacion', label: 'Sistema de puntuación utilizado', type: 'enum', selection: 'single', scored: false, options: [
        { value: 'shulman', label: 'Shulman (0-5)', score: 0 },
        { value: 'moca_cdt', label: 'MoCA-CDT / 3 puntos (0-3)', score: 0 },
        { value: 'sunderland', label: 'Sunderland (1-10)', score: 0 },
        { value: 'rouleau', label: 'Rouleau (0-10)', score: 0 }
      ]},
      { name: 'observaciones', label: 'Errores cualitativos observados', type: 'textarea', scored: false }
    ],
    scoring: {
      producesScore: true,
      mode: 'manual',
      manualScoreField: 'puntaje_manual',
      method: 'Puntaje asignado por el clínico según el sistema elegido.',
      range: 'Depende del sistema (Shulman 0-5 por defecto)',
      scoreVersion: 'reloj_manual',
      // Bandas de Shulman; solo se aplican cuando sistema_puntuacion === 'shulman'.
      interpretation: [
        { min: 0, max: 0, label: 'Incapaz de representar un reloj' },
        { min: 1, max: 3, label: 'Alteración moderada-severa' },
        { min: 4, max: 4, label: 'Errores menores' },
        { min: 5, max: 5, label: 'Normal' }
      ]
    }
  },
  {
    id: 'tmt',
    name: 'Trail Making Test (TMT-A y TMT-B)',
    domain: 'Cognitivo — atención (A) y función ejecutiva (B)',
    defaultOnCreate: false,
    fields: [
      { name: 'tmt_a_segundos', label: 'TMT-A: tiempo (segundos)', type: 'number', scored: false, min: 0, max: 300, unit: 's' },
      { name: 'tmt_a_errores', label: 'TMT-A: nº de errores', type: 'number', scored: false, min: 0 },
      { name: 'tmt_a_discontinuado', label: 'TMT-A discontinuado (>300s / no completa)', type: 'boolean', scored: false },
      { name: 'tmt_b_segundos', label: 'TMT-B: tiempo (segundos)', type: 'number', scored: false, min: 0, max: 300, unit: 's' },
      { name: 'tmt_b_errores', label: 'TMT-B: nº de errores', type: 'number', scored: false, min: 0 },
      { name: 'tmt_b_discontinuado', label: 'TMT-B discontinuado (>300s / no completa)', type: 'boolean', scored: false },
      { name: 'escolaridad_anios', label: 'Años de escolaridad (para normas)', type: 'number', scored: false, min: 0, max: 30 },
      { name: 'observaciones', label: 'Observaciones', type: 'textarea', scored: false }
    ],
    scoring: {
      producesScore: false,
      mode: 'manual',
      method: 'Sin puntaje sumado. Tiempos por parte + derivados B−A y B/A.',
      range: '0-300 s por parte',
      scoreVersion: 'tmt_ab'
    }
  },
  {
    id: 'tinetti',
    name: 'Tinetti (POMA)',
    domain: 'Marcha y equilibrio — riesgo de caídas',
    defaultOnCreate: false,
    // Versión colapsada del spec: equilibrio 0-16, marcha 0-10 (el original desdobla algunos
    // ítems por lado para llegar a 12/28; acá el total maxea en 26 y las bandas de riesgo igual aplican).
    fields: [
      { name: 'eq_sentado', label: 'Equilibrio sentado', type: 'enum', selection: 'single', scored: true, subscale: 'equilibrio', options: [
        { value: '0', label: 'Se inclina o desliza en la silla', score: 0 }, { value: '1', label: 'Estable, seguro', score: 1 } ]},
      { name: 'eq_levantarse', label: 'Levantarse', type: 'enum', selection: 'single', scored: true, subscale: 'equilibrio', options: [
        { value: '0', label: 'Incapaz sin ayuda', score: 0 }, { value: '1', label: 'Capaz usando brazos', score: 1 }, { value: '2', label: 'Capaz sin usar brazos', score: 2 } ]},
      { name: 'eq_intentos_levantarse', label: 'Intentos de levantarse', type: 'enum', selection: 'single', scored: true, subscale: 'equilibrio', options: [
        { value: '0', label: 'Incapaz sin ayuda', score: 0 }, { value: '1', label: 'Capaz, requiere >1 intento', score: 1 }, { value: '2', label: 'Capaz en 1 intento', score: 2 } ]},
      { name: 'eq_bipedestacion_inmediata', label: 'Bipedestación inmediata (primeros 5s)', type: 'enum', selection: 'single', scored: true, subscale: 'equilibrio', options: [
        { value: '0', label: 'Inestable', score: 0 }, { value: '1', label: 'Estable con apoyo/andador', score: 1 }, { value: '2', label: 'Estable sin apoyo', score: 2 } ]},
      { name: 'eq_bipedestacion', label: 'Bipedestación (prolongado)', type: 'enum', selection: 'single', scored: true, subscale: 'equilibrio', options: [
        { value: '0', label: 'Inestable', score: 0 }, { value: '1', label: 'Estable con base amplia o apoyo', score: 1 }, { value: '2', label: 'Base estrecha sin apoyo', score: 2 } ]},
      { name: 'eq_empujon', label: 'Empujón esternal (pies juntos)', type: 'enum', selection: 'single', scored: true, subscale: 'equilibrio', options: [
        { value: '0', label: 'Comienza a caer', score: 0 }, { value: '1', label: 'Se tambalea, se agarra', score: 1 }, { value: '2', label: 'Estable', score: 2 } ]},
      { name: 'eq_ojos_cerrados', label: 'Ojos cerrados (de pie)', type: 'enum', selection: 'single', scored: true, subscale: 'equilibrio', options: [
        { value: '0', label: 'Inestable', score: 0 }, { value: '1', label: 'Estable', score: 1 } ]},
      { name: 'eq_giro_360', label: 'Giro de 360°', type: 'enum', selection: 'single', scored: true, subscale: 'equilibrio', options: [
        { value: '0', label: 'Pasos discontinuos e inestable', score: 0 }, { value: '1', label: 'Discontinuo pero estable', score: 1 }, { value: '2', label: 'Continuo y estable', score: 2 } ]},
      { name: 'eq_sentarse', label: 'Sentarse', type: 'enum', selection: 'single', scored: true, subscale: 'equilibrio', options: [
        { value: '0', label: 'Inseguro, cae en silla', score: 0 }, { value: '1', label: 'Usa brazos o movimiento brusco', score: 1 }, { value: '2', label: 'Seguro, movimiento suave', score: 2 } ]},
      { name: 'marcha_inicio', label: 'Inicio de la marcha', type: 'enum', selection: 'single', scored: true, subscale: 'marcha', options: [
        { value: '0', label: 'Vacila o múltiples intentos', score: 0 }, { value: '1', label: 'Sin vacilación', score: 1 } ]},
      { name: 'marcha_long_altura_paso', label: 'Longitud y altura del paso', type: 'enum', selection: 'single', scored: true, subscale: 'marcha', options: [
        { value: '0', label: 'Anormal', score: 0 }, { value: '2', label: 'Normal (ambos pies)', score: 2 } ]},
      { name: 'marcha_simetria', label: 'Simetría del paso', type: 'enum', selection: 'single', scored: true, subscale: 'marcha', options: [
        { value: '0', label: 'Longitud desigual', score: 0 }, { value: '1', label: 'Simétrica', score: 1 } ]},
      { name: 'marcha_continuidad', label: 'Continuidad de los pasos', type: 'enum', selection: 'single', scored: true, subscale: 'marcha', options: [
        { value: '0', label: 'Paradas o discontinuidad', score: 0 }, { value: '1', label: 'Continuos', score: 1 } ]},
      { name: 'marcha_trayectoria', label: 'Trayectoria', type: 'enum', selection: 'single', scored: true, subscale: 'marcha', options: [
        { value: '0', label: 'Desviación marcada', score: 0 }, { value: '1', label: 'Desviación leve o usa ayuda', score: 1 }, { value: '2', label: 'Recta sin ayuda', score: 2 } ]},
      { name: 'marcha_tronco', label: 'Tronco', type: 'enum', selection: 'single', scored: true, subscale: 'marcha', options: [
        { value: '0', label: 'Balanceo marcado o usa ayuda', score: 0 }, { value: '1', label: 'Flexiona rodillas/espalda o abre brazos', score: 1 }, { value: '2', label: 'Sin balanceo ni uso de brazos', score: 2 } ]},
      { name: 'marcha_postura', label: 'Postura al caminar', type: 'enum', selection: 'single', scored: true, subscale: 'marcha', options: [
        { value: '0', label: 'Talones separados', score: 0 }, { value: '1', label: 'Talones casi se tocan', score: 1 } ]}
    ],
    scoring: {
      producesScore: true,
      mode: 'auto',
      producesTotal: true,
      method: 'Suma de subescalas: Equilibrio + Marcha.',
      range: '0-26 (equilibrio 0-16, marcha 0-10)',
      scoreVersion: 'tinetti_poma',
      subscales: [
        { name: 'equilibrio', label: 'Equilibrio', max: 16, interpretation: null },
        { name: 'marcha', label: 'Marcha', max: 10, interpretation: null }
      ],
      interpretation: [
        { min: 25, max: 28, label: 'Riesgo de caídas bajo' },
        { min: 19, max: 24, label: 'Riesgo de caídas moderado' },
        { min: 0, max: 18, label: 'Riesgo de caídas alto' }
      ]
    }
  },
  {
    id: 'berg',
    name: 'Escala de equilibrio de Berg',
    domain: 'Equilibrio — riesgo de caídas',
    defaultOnCreate: false,
    fields: [
      'De sentado a de pie', 'De pie sin apoyo', 'Sentado sin apoyo', 'De pie a sentado',
      'Transferencias', 'De pie con ojos cerrados', 'De pie con pies juntos',
      'Alcanzar hacia adelante con brazo extendido', 'Recoger objeto del suelo',
      'Girarse para mirar atrás', 'Giro de 360°', 'Colocar pies alternos sobre escalón',
      'De pie con un pie delante (tándem)', 'De pie sobre una pierna'
    ].map((label, i) => ({
      name: `item_${i + 1}`,
      label: `${i + 1}. ${label}`,
      type: 'enum',
      selection: 'single',
      scored: true,
      options: [0, 1, 2, 3, 4].map(n => ({ value: String(n), label: String(n), score: n }))
    })),
    scoring: {
      producesScore: true,
      mode: 'auto',
      method: 'Suma de los 14 ítems (0-4 cada uno).',
      range: '0-56',
      scoreVersion: 'berg_56',
      interpretation: [
        { min: 41, max: 56, label: 'Bajo riesgo / marcha independiente' },
        { min: 21, max: 40, label: 'Riesgo medio / marcha con asistencia' },
        { min: 0, max: 20, label: 'Alto riesgo / dependiente' }
      ]
    }
  },
  {
    id: 'tug',
    name: 'Timed Up and Go (TUG)',
    domain: 'Movilidad — riesgo de caídas',
    defaultOnCreate: false,
    fields: [
      { name: 'tiempo_segundos', label: 'Tiempo (segundos)', type: 'number', scored: false, min: 0, unit: 's' },
      { name: 'ayuda_tecnica', label: 'Ayuda técnica usada', type: 'enum', selection: 'single', scored: false, options: [
        { value: 'ninguna', label: 'Ninguna', score: 0 }, { value: 'baston', label: 'Bastón', score: 0 },
        { value: 'andador', label: 'Andador', score: 0 }, { value: 'otra', label: 'Otra', score: 0 } ]},
      { name: 'variante', label: 'Variante de la prueba', type: 'enum', selection: 'single', scored: false, options: [
        { value: 'estandar', label: 'Estándar', score: 0 }, { value: 'cognitiva', label: 'TUG-cognitivo', score: 0 },
        { value: 'manual', label: 'TUG-manual (con vaso de agua)', score: 0 } ]},
      { name: 'observaciones', label: 'Observaciones (marcha, equilibrio)', type: 'textarea', scored: false }
    ],
    scoring: {
      producesScore: true,
      mode: 'manual',
      manualScoreField: 'tiempo_segundos',
      method: 'Medida única: tiempo en segundos.',
      range: 'segundos',
      scoreVersion: 'tug_seg',
      interpretation: [
        { min: 0, max: 9.99, label: 'Normal / movilidad conservada' },
        { min: 10, max: 13.49, label: 'Intermedio' },
        { min: 13.5, max: 19.99, label: 'Mayor riesgo de caídas' },
        { min: 20, max: 9999, label: 'Deterioro de movilidad marcado' }
      ]
    }
  },
  {
    id: 'goldberg',
    name: 'Escala de Ansiedad y Depresión de Goldberg (GADS)',
    domain: 'Afectivo — cribado de ansiedad y depresión',
    defaultOnCreate: false,
    // Dos subescalas independientes (0-9 c/u), respuesta sí (=1). Sin total combinado.
    fields: [
      { name: 'ans_1_nervioso', label: 'A1. ¿Se ha sentido excitado, nervioso o en tensión?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'ansiedad', screening: true },
      { name: 'ans_2_preocupado', label: 'A2. ¿Ha estado muy preocupado por algo?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'ansiedad', screening: true },
      { name: 'ans_3_irritable', label: 'A3. ¿Se ha sentido muy irritable?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'ansiedad', screening: true },
      { name: 'ans_4_relajarse', label: 'A4. ¿Ha tenido dificultad para relajarse?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'ansiedad', screening: true },
      { name: 'ans_5_dormir', label: 'A5. ¿Ha dormido mal?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'ansiedad', screening: false },
      { name: 'ans_6_cabeza', label: 'A6. ¿Ha tenido dolores de cabeza o nuca?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'ansiedad', screening: false },
      { name: 'ans_7_sintomas', label: 'A7. ¿Temblores, hormigueos, mareos, sudores, diarrea?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'ansiedad', screening: false },
      { name: 'ans_8_preocupado_salud', label: 'A8. ¿Ha estado preocupado por su salud?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'ansiedad', screening: false },
      { name: 'ans_9_conciliar', label: 'A9. ¿Dificultad para conciliar el sueño?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'ansiedad', screening: false },
      { name: 'dep_1_energia', label: 'D1. ¿Se ha sentido con poca energía?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'depresion', screening: true },
      { name: 'dep_2_interes', label: 'D2. ¿Ha perdido el interés por las cosas?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'depresion', screening: true },
      { name: 'dep_3_confianza', label: 'D3. ¿Ha perdido la confianza en sí mismo?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'depresion', screening: true },
      { name: 'dep_4_desesperanza', label: 'D4. ¿Se ha sentido sin esperanza?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'depresion', screening: true },
      { name: 'dep_5_concentracion', label: 'D5. ¿Dificultad para concentrarse?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'depresion', screening: false },
      { name: 'dep_6_peso', label: 'D6. ¿Ha perdido peso (por falta de apetito)?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'depresion', screening: false },
      { name: 'dep_7_despertar', label: 'D7. ¿Se ha estado despertando muy temprano?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'depresion', screening: false },
      { name: 'dep_8_enlentecido', label: 'D8. ¿Se ha sentido enlentecido?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'depresion', screening: false },
      { name: 'dep_9_peor_manana', label: 'D9. ¿Tendencia a encontrarse peor por las mañanas?', type: 'boolean', scored: true, scoredAnswer: true, subscale: 'depresion', screening: false }
    ],
    scoring: {
      producesScore: true,
      mode: 'auto',
      method: 'Dos puntajes independientes (suma de "sí" por subescala).',
      range: 'Ansiedad 0-9 · Depresión 0-9',
      scoreVersion: 'gads_18',
      subscales: [
        { name: 'ansiedad', label: 'Ansiedad', max: 9, interpretation: [
          { min: 0, max: 3, label: 'Ansiedad: poco probable' },
          { min: 4, max: 9, label: 'Ansiedad: probable caso' }
        ]},
        { name: 'depresion', label: 'Depresión', max: 9, interpretation: [
          { min: 0, max: 1, label: 'Depresión: poco probable' },
          { min: 2, max: 9, label: 'Depresión: probable caso' }
        ]}
      ]
    }
  },
  {
    id: 'yesavage_gds',
    name: 'Depresión Geriátrica de Yesavage (GDS-15)',
    domain: 'Afectivo — cribado de depresión en mayores',
    defaultOnCreate: false,
    // scoredAnswer = respuesta que suma 1 (dirección variable por ítem).
    fields: [
      { name: 'q1', label: '1. ¿Está básicamente satisfecho con su vida?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q2', label: '2. ¿Ha abandonado muchas actividades e intereses?', type: 'boolean', scored: true, scoredAnswer: true },
      { name: 'q3', label: '3. ¿Siente que su vida está vacía?', type: 'boolean', scored: true, scoredAnswer: true },
      { name: 'q4', label: '4. ¿Se siente a menudo aburrido?', type: 'boolean', scored: true, scoredAnswer: true },
      { name: 'q5', label: '5. ¿Está de buen ánimo la mayor parte del tiempo?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q6', label: '6. ¿Tiene miedo de que algo malo le pase?', type: 'boolean', scored: true, scoredAnswer: true },
      { name: 'q7', label: '7. ¿Se siente feliz la mayor parte del tiempo?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q8', label: '8. ¿Se siente a menudo desamparado?', type: 'boolean', scored: true, scoredAnswer: true },
      { name: 'q9', label: '9. ¿Prefiere quedarse en casa en vez de salir?', type: 'boolean', scored: true, scoredAnswer: true },
      { name: 'q10', label: '10. ¿Tiene más problemas de memoria que la mayoría?', type: 'boolean', scored: true, scoredAnswer: true },
      { name: 'q11', label: '11. ¿Piensa que es maravilloso estar vivo?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q12', label: '12. ¿Se siente bastante inútil tal como está ahora?', type: 'boolean', scored: true, scoredAnswer: true },
      { name: 'q13', label: '13. ¿Se siente lleno de energía?', type: 'boolean', scored: true, scoredAnswer: false },
      { name: 'q14', label: '14. ¿Siente que su situación es desesperada?', type: 'boolean', scored: true, scoredAnswer: true },
      { name: 'q15', label: '15. ¿Cree que la mayoría está mejor que usted?', type: 'boolean', scored: true, scoredAnswer: true }
    ],
    scoring: {
      producesScore: true,
      mode: 'auto',
      method: 'Suma de ítems donde la respuesta coincide con scoredAnswer.',
      range: '0-15',
      scoreVersion: 'gds15',
      interpretation: [
        { min: 0, max: 4, label: 'Normal / sin depresión' },
        { min: 5, max: 8, label: 'Depresión leve' },
        { min: 9, max: 11, label: 'Depresión moderada' },
        { min: 12, max: 15, label: 'Depresión severa' }
      ]
    }
  }
]

export function getTestById(testId) {
  return TESTS_CATALOG.find(t => t.id === testId)
}

// Máximo puntaje del total. null si el test no tiene total sumable
// (manual/TMT o solo-subescalas como Goldberg).
export function getMaxScore(test) {
  const sc = test.scoring || {}
  if (sc.mode === 'manual') return null
  if (!sc.interpretation && !sc.producesTotal) return null
  return test.fields
    .filter(f => f.scored)
    .reduce((sum, f) => {
      if (f.type === 'enum') return sum + Math.max(...f.options.map(o => o.score))
      if (f.type === 'boolean') return sum + 1
      return sum
    }, 0)
}
