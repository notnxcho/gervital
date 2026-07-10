# Clinical Tests Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar evaluaciones clínicas (Lawton & Brody IADL y Barthel) por cliente, con historial temporal de instancias, formulario dinámico y evolución del puntaje.

**Architecture:** Catálogo + scoring como constantes de frontend (`testsCatalog.js` / `testScoring.js`, puro y testeado). Una sola tabla genérica `client_test_instances` con respuestas en `jsonb`. Servicio CRUD delgado sobre Supabase. UI: paso 4 opcional en el alta (instancia génesis) y tab "Tests" en el detalle (lista → drill-down con gráfico + modal de formulario dinámico).

**Tech Stack:** React 19, Supabase (PostgreSQL + RLS), Tailwind, Jest (CRA), date-fns, iconoir-react.

## Global Constraints

- Variables y código en inglés; textos de UI en español.
- Sin `;` en JS/JSX cuando no es obligatorio.
- `// MOCKED RES` en datos/funciones mockeadas (no aplica acá: todo es real).
- Named exports para servicios; default export para componentes de página.
- Servicios en `src/services/<domain>/`, usan el cliente Supabase directo y re-exportan por `src/services/api.js`.
- Tailwind se compila manual: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css` tras cambios de clases nuevas.
- Rama de trabajo: `feat/clinical-tests` (ya creada).
- `test_id` NO lleva CHECK en DB (catálogo crece sin migración; se valida en frontend).
- Puntaje/interpretación se **snapshotean** en la instancia al guardar.
- Tests clínicos = dato clínico, sin gate por rol (todos los autenticados), igual que la ficha médica.

---

### Task 1: Catálogo de tests + motor de scoring (puro, con tests)

**Files:**
- Create: `src/services/clients/testsCatalog.js`
- Create: `src/services/clients/testScoring.js`
- Test: `src/services/clients/testScoring.test.js`

**Interfaces:**
- Produces:
  - `TESTS_CATALOG: Array<Test>` y `getTestById(testId): Test | undefined` desde `testsCatalog.js`.
  - `Test = { id, name, domain, defaultOnCreate, fields: Field[], scoring: Scoring }`
  - `Field = { name, label, type: 'enum', selection: 'single', scored: boolean, options: {value,label,score}[], note? }`
  - `Scoring = { producesScore, autoCalculated, method, range, scoreVersion, interpretation: {min,max,label}[] }`
  - `computeScore(test, answers): { rawScore, interpretationLabel, scoreVersion, isComplete }` desde `testScoring.js`. `answers` = `{ [fieldName]: optionValue }`.

- [ ] **Step 1: Write the failing test**

Create `src/services/clients/testScoring.test.js`:

```js
import { computeScore } from './testScoring'
import { getTestById } from './testsCatalog'

const lawton = getTestById('lawton_brody')
const barthel = getTestById('barthel')

describe('computeScore - Lawton & Brody', () => {
  test('all-independent answers sum to 8 and read as independiente', () => {
    const answers = {
      telefono: 'usa_iniciativa', compras: 'independiente', cocina: 'planea_prepara',
      tareas_hogar: 'solo_o_ayuda_tareas_pesadas', lavado_ropa: 'independiente',
      transporte: 'publico_o_conduce', medicacion: 'responsable', finanzas: 'independiente'
    }
    const res = computeScore(lawton, answers)
    expect(res.rawScore).toBe(8)
    expect(res.isComplete).toBe(true)
    expect(res.interpretationLabel).toBe('Independiente (mujer)')
    expect(res.scoreVersion).toBe('lawton_unisex_8')
  })

  test('incomplete answers → isComplete false, no interpretation', () => {
    const res = computeScore(lawton, { telefono: 'usa_iniciativa' })
    expect(res.isComplete).toBe(false)
    expect(res.rawScore).toBe(1)
    expect(res.interpretationLabel).toBeNull()
  })

  test('boundary: score 6 → dependencia leve', () => {
    const answers = {
      telefono: 'usa_iniciativa', compras: 'independiente', cocina: 'planea_prepara',
      tareas_hogar: 'solo_o_ayuda_tareas_pesadas', lavado_ropa: 'independiente',
      transporte: 'publico_o_conduce', medicacion: 'incapaz', finanzas: 'incapaz'
    }
    const res = computeScore(lawton, answers)
    expect(res.rawScore).toBe(6)
    expect(res.interpretationLabel).toBe('Dependencia leve')
  })
})

describe('computeScore - Barthel', () => {
  test('all-independent answers sum to 100 → Independiente', () => {
    const answers = {
      comer: 'independiente', lavarse: 'independiente', vestirse: 'independiente',
      arreglarse: 'independiente', deposiciones: 'continente', miccion: 'continente',
      uso_retrete: 'independiente', traslado: 'independiente', deambulacion: 'independiente',
      escaleras: 'independiente'
    }
    const res = computeScore(barthel, answers)
    expect(res.rawScore).toBe(100)
    expect(res.interpretationLabel).toBe('Independiente')
  })

  test('boundary: 90 → dependencia moderada', () => {
    const answers = {
      comer: 'independiente', lavarse: 'independiente', vestirse: 'independiente',
      arreglarse: 'independiente', deposiciones: 'continente', miccion: 'continente',
      uso_retrete: 'independiente', traslado: 'independiente', deambulacion: 'independiente',
      escaleras: 'dependiente'
    }
    const res = computeScore(barthel, answers)
    expect(res.rawScore).toBe(90)
    expect(res.interpretationLabel).toBe('Dependencia moderada')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `CI=true npx react-scripts test src/services/clients/testScoring.test.js --watchAll=false`
Expected: FAIL — `Cannot find module './testScoring'` / `./testsCatalog`.

- [ ] **Step 3: Write the catalog**

Create `src/services/clients/testsCatalog.js`. Transcribe los 2 tests del spec (Lawton unisex 8 ítems, Barthel 10 ítems). Cada `scoring` lleva un `scoreVersion` estable:

```js
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
```

- [ ] **Step 4: Write the scoring engine**

Create `src/services/clients/testScoring.js`:

```js
// Motor de scoring puro. answers = { [fieldName]: optionValue }.
export function computeScore(test, answers = {}) {
  const scoredFields = test.fields.filter(f => f.scored)
  let rawScore = 0
  let answeredCount = 0
  for (const field of scoredFields) {
    const value = answers[field.name]
    if (value == null || value === '') continue
    const option = field.options.find(o => o.value === value)
    if (option) {
      rawScore += option.score
      answeredCount += 1
    }
  }
  const isComplete = answeredCount === scoredFields.length
  const interpretationLabel = isComplete ? interpret(test, rawScore) : null
  return { rawScore, interpretationLabel, scoreVersion: test.scoring.scoreVersion, isComplete }
}

// Banda de interpretación cuyo [min,max] contiene el puntaje.
function interpret(test, rawScore) {
  const band = test.scoring.interpretation.find(b => rawScore >= b.min && rawScore <= b.max)
  return band ? band.label : null
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `CI=true npx react-scripts test src/services/clients/testScoring.test.js --watchAll=false`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/clients/testsCatalog.js src/services/clients/testScoring.js src/services/clients/testScoring.test.js
git commit -m "feat(tests): catálogo clínico + motor de scoring (Lawton + Barthel)"
```

---

### Task 2: Migración DB — tabla `client_test_instances`

**Files:**
- Create: `supabase/migrations/058_client_test_instances.sql`

**Interfaces:**
- Produces: tabla `client_test_instances` con RLS aplicada. Consumida por Task 3.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/058_client_test_instances.sql`:

```sql
-- ════════════════════════════════════════════════════════════════════════════
-- 058_client_test_instances.sql
-- Instancias de tests clínicos por cliente (modelo genérico). El catálogo y el
-- scoring viven en frontend (testsCatalog.js); acá solo se guardan las tomas.
-- test_id SIN CHECK a propósito: el catálogo crece sin migración.
-- ════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_test_instances (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id            UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  test_id              TEXT NOT NULL,
  administered_at      DATE NOT NULL,
  administered_by      TEXT,
  is_genesis           BOOLEAN NOT NULL DEFAULT false,
  answers              JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_score            NUMERIC,
  subscores            JSONB,
  interpretation_label TEXT,
  score_version        TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_test_instances_client_test
  ON client_test_instances (client_id, test_id, administered_at DESC);

-- RLS: espeja las tablas médicas (is_authenticated() para todo).
ALTER TABLE client_test_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cti_select ON client_test_instances;
DROP POLICY IF EXISTS cti_insert ON client_test_instances;
DROP POLICY IF EXISTS cti_update ON client_test_instances;
DROP POLICY IF EXISTS cti_delete ON client_test_instances;
CREATE POLICY cti_select ON client_test_instances FOR SELECT USING (is_authenticated());
CREATE POLICY cti_insert ON client_test_instances FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY cti_update ON client_test_instances FOR UPDATE USING (is_authenticated());
CREATE POLICY cti_delete ON client_test_instances FOR DELETE USING (is_authenticated());
```

- [ ] **Step 2: Apply the migration**

Aplicar vía MCP Supabase `apply_migration` (name: `058_client_test_instances`, query = contenido del archivo). Verificar con `list_tables` que `client_test_instances` existe con RLS habilitada.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/058_client_test_instances.sql
git commit -m "feat(tests): migración client_test_instances + RLS"
```

---

### Task 3: Servicio CRUD + facade

**Files:**
- Create: `src/services/clients/testInstanceService.js`
- Modify: `src/services/api.js` (agregar re-export)

**Interfaces:**
- Consumes: `supabase` de `../supabase/client`.
- Produces (todos re-exportados por `api.js`):
  - `getClientTestInstances(clientId): Promise<Instance[]>` — orden `administered_at DESC`.
  - `createTestInstance(clientId, payload): Promise<Instance>`
  - `updateTestInstance(id, payload): Promise<Instance>`
  - `deleteTestInstance(id): Promise<void>`
  - `Instance = { id, clientId, testId, administeredAt, administeredBy, isGenesis, answers, rawScore, subscores, interpretationLabel, scoreVersion, notes, createdAt, updatedAt }`
  - `payload = { testId, administeredAt, administeredBy, isGenesis, answers, rawScore, subscores, interpretationLabel, scoreVersion, notes }`

- [ ] **Step 1: Write the service**

Create `src/services/clients/testInstanceService.js`:

```js
import { supabase } from '../supabase/client'

// Fila DB → objeto camelCase de frontend.
function fromDb(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    testId: row.test_id,
    administeredAt: row.administered_at,
    administeredBy: row.administered_by,
    isGenesis: row.is_genesis,
    answers: row.answers || {},
    rawScore: row.raw_score,
    subscores: row.subscores || null,
    interpretationLabel: row.interpretation_label,
    scoreVersion: row.score_version,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// Payload de frontend → columnas DB (sin client_id, que va aparte en create).
function toDb(payload) {
  return {
    test_id: payload.testId,
    administered_at: payload.administeredAt,
    administered_by: payload.administeredBy ?? null,
    is_genesis: payload.isGenesis ?? false,
    answers: payload.answers ?? {},
    raw_score: payload.rawScore ?? null,
    subscores: payload.subscores ?? null,
    interpretation_label: payload.interpretationLabel ?? null,
    score_version: payload.scoreVersion ?? null,
    notes: payload.notes ?? null
  }
}

export async function getClientTestInstances(clientId) {
  const { data, error } = await supabase
    .from('client_test_instances')
    .select('*')
    .eq('client_id', clientId)
    .order('administered_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data.map(fromDb)
}

export async function createTestInstance(clientId, payload) {
  const { data, error } = await supabase
    .from('client_test_instances')
    .insert({ client_id: clientId, ...toDb(payload) })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return fromDb(data)
}

export async function updateTestInstance(id, payload) {
  const { data, error } = await supabase
    .from('client_test_instances')
    .update({ ...toDb(payload), updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(error.message)
  return fromDb(data)
}

export async function deleteTestInstance(id) {
  const { error } = await supabase.from('client_test_instances').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 2: Re-export from facade**

En `src/services/api.js`, tras el bloque `CLIENTS API`, agregar:

```js
// ============================================
// CLIENT TEST INSTANCES API
// ============================================
export {
  getClientTestInstances,
  createTestInstance,
  updateTestInstance,
  deleteTestInstance
} from './clients/testInstanceService'
```

- [ ] **Step 3: Verify it compiles**

Run: `CI=true npx react-scripts test --watchAll=false --testPathPattern=testScoring` (sanity — asegura que el bundle de imports no rompió). Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/services/clients/testInstanceService.js src/services/api.js
git commit -m "feat(tests): servicio CRUD de instancias + facade"
```

---

### Task 4: `TestInstanceModal` — formulario dinámico

**Files:**
- Create: `src/pages/Clients/TestInstanceModal.jsx`

**Interfaces:**
- Consumes: `computeScore` (`testScoring`), `getMaxScore` (`testsCatalog`), `createTestInstance`/`updateTestInstance` (`api`), `Modal`, `Button`, `Select`, `Textarea`, `Input`.
- Produces: `default export TestInstanceModal(props)` con props:
  `{ isOpen, onClose, test, clientId, instance?, mode: 'create'|'edit'|'view', administeredBy, defaultDate?, onSaved }`.
  - `test` = objeto del catálogo. `instance` (edit/view) = `Instance`. `onSaved()` se llama tras guardar.

- [ ] **Step 1: Write the component**

Create `src/pages/Clients/TestInstanceModal.jsx`:

```jsx
import { useState, useEffect } from 'react'
import Modal from '../../components/ui/Modal'
import Button from '../../components/ui/Button'
import { Select, Textarea } from '../../components/ui/Input'
import { computeScore } from '../../services/clients/testScoring'
import { getMaxScore } from '../../services/clients/testsCatalog'
import { createTestInstance, updateTestInstance } from '../../services/api'

const MODE_TITLES = { create: 'Nueva evaluación', edit: 'Editar evaluación', view: 'Evaluación' }

export default function TestInstanceModal({ isOpen, onClose, test, clientId, instance, mode = 'create', administeredBy, defaultDate, onSaved }) {
  const readOnly = mode === 'view'
  const [answers, setAnswers] = useState({})
  const [administeredAt, setAdministeredAt] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Reset form each time the modal opens or the target instance changes.
  useEffect(() => {
    if (!isOpen) return
    setAnswers(instance?.answers || {})
    setAdministeredAt(instance?.administeredAt || defaultDate || new Date().toISOString().split('T')[0])
    setNotes(instance?.notes || '')
    setError(null)
  }, [isOpen, instance, defaultDate])

  if (!test) return null

  const { rawScore, interpretationLabel, scoreVersion, isComplete } = computeScore(test, answers)
  const maxScore = getMaxScore(test)

  const setAnswer = (fieldName, value) => setAnswers(prev => ({ ...prev, [fieldName]: value }))

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        testId: test.id,
        administeredAt,
        administeredBy,
        isGenesis: instance?.isGenesis ?? false,
        answers,
        rawScore,
        subscores: null,
        interpretationLabel,
        scoreVersion,
        notes
      }
      if (mode === 'edit' && instance) await updateTestInstance(instance.id, payload)
      else await createTestInstance(clientId, payload)
      onSaved()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`${MODE_TITLES[mode]} · ${test.name}`} size="lg">
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {/* Fecha de toma */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Fecha de la evaluación</label>
          <input
            type="date"
            value={administeredAt}
            onChange={e => setAdministeredAt(e.target.value)}
            disabled={readOnly}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100"
          />
        </div>

        {/* Ítems */}
        {test.fields.map(field => (
          <Select
            key={field.name}
            label={field.label}
            value={answers[field.name] ?? ''}
            onChange={e => setAnswer(field.name, e.target.value)}
            disabled={readOnly}
            options={[{ value: '', label: 'Seleccionar…' }, ...field.options.map(o => ({ value: o.value, label: `${o.label} (${o.score})` }))]}
          />
        ))}

        {/* Notas */}
        <Textarea label="Observaciones" value={notes} onChange={e => setNotes(e.target.value)} disabled={readOnly} rows={2} />

        {/* Puntaje en vivo */}
        <div className="bg-indigo-50 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="text-sm text-indigo-700">Puntaje</p>
            <p className="text-2xl font-bold text-indigo-900">{rawScore}<span className="text-base font-normal text-indigo-500">/{maxScore}</span></p>
          </div>
          <div className="text-right">
            <p className="text-sm text-indigo-700">Interpretación</p>
            <p className="font-semibold text-indigo-900">{isComplete ? interpretationLabel : 'Incompleto'}</p>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-gray-200">
        <Button variant="secondary" onClick={onClose}>{readOnly ? 'Cerrar' : 'Cancelar'}</Button>
        {!readOnly && <Button onClick={handleSave} loading={saving}>Guardar</Button>}
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `CI=true npx react-scripts test --watchAll=false --testPathPattern=testScoring`
Expected: PASS (no import/parse errors in the tree).

- [ ] **Step 3: Commit**

```bash
git add src/pages/Clients/TestInstanceModal.jsx
git commit -m "feat(tests): modal de formulario dinámico de evaluación"
```

---

### Task 5: `ClientTests` — tab (lista + drill-down + gráfico)

**Files:**
- Create: `src/pages/Clients/ClientTests.jsx`

**Interfaces:**
- Consumes: `TESTS_CATALOG`, `getMaxScore` (`testsCatalog`), `computeScore` no hace falta acá, `deleteTestInstance` (`api`), `TestInstanceModal`, `Button`, `Card`, iconoir icons, date-fns `format`.
- Produces: `default export ClientTests({ clientId, instances, administeredBy, canMutate, onRefresh })`.
  - `instances` = array de todas las instancias del cliente (todos los tests). El componente filtra por `testId`.

- [ ] **Step 1: Write the component**

Create `src/pages/Clients/ClientTests.jsx`:

```jsx
import { useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { NavArrowRight, ArrowLeft, Plus, Edit, Trash, Eye } from 'iconoir-react'
import Button from '../../components/ui/Button'
import { TESTS_CATALOG, getMaxScore } from '../../services/clients/testsCatalog'
import { deleteTestInstance } from '../../services/api'
import TestInstanceModal from './TestInstanceModal'

function fmtDate(d) {
  return d ? format(new Date(`${d}T12:00:00`), "d MMM yyyy", { locale: es }) : '—'
}

// Mini gráfico de evolución del puntaje (pure SVG). asc por fecha.
function ScoreTrend({ points, maxScore }) {
  if (points.length < 2) return null
  const W = 320, H = 80, P = 8
  const xs = points.map((_, i) => P + (i * (W - 2 * P)) / (points.length - 1))
  const ys = points.map(p => H - P - ((p.score / maxScore) * (H - 2 * P)))
  const path = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20">
      <path d={path} fill="none" stroke="#4f46e5" strokeWidth="2" />
      {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="3" fill="#4f46e5" />)}
    </svg>
  )
}

export default function ClientTests({ clientId, instances, administeredBy, canMutate, onRefresh }) {
  const [selectedTestId, setSelectedTestId] = useState(null)
  const [modal, setModal] = useState(null) // { mode, instance? }

  const selectedTest = TESTS_CATALOG.find(t => t.id === selectedTestId)
  const instancesFor = (testId) => instances
    .filter(i => i.testId === testId)
    .sort((a, b) => (a.administeredAt < b.administeredAt ? 1 : -1)) // desc

  const handleDelete = async (instance) => {
    if (!window.confirm('¿Eliminar esta evaluación? No se puede deshacer.')) return
    try { await deleteTestInstance(instance.id); await onRefresh() }
    catch (e) { window.alert(e.message) }
  }

  // ── Vista lista ──
  if (!selectedTest) {
    return (
      <div className="space-y-3">
        {TESTS_CATALOG.map(test => {
          const list = instancesFor(test.id)
          const last = list[0]
          const maxScore = getMaxScore(test)
          return (
            <button
              key={test.id}
              onClick={() => setSelectedTestId(test.id)}
              className="w-full flex items-center justify-between rounded-xl border border-gray-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors"
            >
              <div>
                <p className="font-semibold text-gray-900">{test.name}</p>
                <p className="text-sm text-gray-500">{test.domain}</p>
                <p className="text-sm mt-1">
                  {last
                    ? <span className="text-gray-700">Último: <span className="font-medium">{last.rawScore}/{maxScore}</span> · {last.interpretationLabel || 's/interpretación'} · {fmtDate(last.administeredAt)}</span>
                    : <span className="text-gray-400">Sin evaluaciones</span>}
                </p>
              </div>
              <NavArrowRight className="w-5 h-5 text-gray-400 flex-shrink-0" />
            </button>
          )
        })}
      </div>
    )
  }

  // ── Drill-down de un test ──
  const list = instancesFor(selectedTest.id)
  const maxScore = getMaxScore(selectedTest)
  const trendPoints = [...list].reverse().map(i => ({ score: Number(i.rawScore) }))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setSelectedTestId(null)} className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        {canMutate && (
          <Button size="sm" onClick={() => setModal({ mode: 'create' })}>
            <Plus className="w-4 h-4" /> Nueva evaluación
          </Button>
        )}
      </div>

      <div className="mb-4">
        <h3 className="font-semibold text-gray-900">{selectedTest.name}</h3>
        <p className="text-sm text-gray-500">{selectedTest.domain} · {selectedTest.scoring.range}</p>
      </div>

      {trendPoints.length >= 2 && (
        <div className="mb-4 rounded-xl border border-gray-200 p-3">
          <p className="text-xs text-gray-500 mb-1">Evolución del puntaje</p>
          <ScoreTrend points={trendPoints} maxScore={maxScore} />
        </div>
      )}

      {list.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Sin evaluaciones. Agregá la primera con "Nueva evaluación".</p>
      ) : (
        <ul className="space-y-2">
          {list.map(inst => (
            <li key={inst.id} className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{inst.rawScore}/{maxScore}</span>
                  {inst.interpretationLabel && <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">{inst.interpretationLabel}</span>}
                  {inst.isGenesis && <span className="px-2 py-0.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">Inicial</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{fmtDate(inst.administeredAt)}{inst.administeredBy ? ` · ${inst.administeredBy}` : ''}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => setModal({ mode: 'view', instance: inst })} className="p-1.5 text-gray-400 hover:text-gray-700" title="Ver"><Eye className="w-4 h-4" /></button>
                {canMutate && <button onClick={() => setModal({ mode: 'edit', instance: inst })} className="p-1.5 text-gray-400 hover:text-indigo-600" title="Editar"><Edit className="w-4 h-4" /></button>}
                {canMutate && <button onClick={() => handleDelete(inst)} className="p-1.5 text-gray-400 hover:text-red-600" title="Eliminar"><Trash className="w-4 h-4" /></button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <TestInstanceModal
        isOpen={!!modal}
        onClose={() => setModal(null)}
        test={selectedTest}
        clientId={clientId}
        instance={modal?.instance}
        mode={modal?.mode || 'create'}
        administeredBy={administeredBy}
        onSaved={async () => { setModal(null); await onRefresh() }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify it compiles**

Run: `CI=true npx react-scripts test --watchAll=false --testPathPattern=testScoring`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Clients/ClientTests.jsx
git commit -m "feat(tests): tab ClientTests con lista, drill-down y evolución"
```

---

### Task 6: Integrar tab "Tests" en `ClientDetail`

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

**Interfaces:**
- Consumes: `getClientTestInstances` (`api`), `ClientTests`.

- [ ] **Step 1: Añadir import**

En el bloque de imports de servicios (`getClientById, ...`) agregar `getClientTestInstances`, y bajo los imports de componentes locales agregar:

```jsx
import ClientTests from './ClientTests'
```

- [ ] **Step 2: Estado y carga**

Agregar estado tras `const [planHistoryOpen, setPlanHistoryOpen] = useState(false)`:

```jsx
  const [testInstances, setTestInstances] = useState([])
```

En `loadClientData`, agregar `getClientTestInstances(id)` al `Promise.all` (y a su destructuring), y setearlo:

```jsx
      const [clientData, attendanceData, invoicesData, pricing, transportPricing, recoveryData, planVersions, testData] = await Promise.all([
        getClientById(id),
        getClientAttendance(id),
        getClientInvoices(id),
        getPlanPricing(),
        getTransportPricing(),
        getRecoveryCredits(id),
        getClientPlanVersions(id),
        getClientTestInstances(id)
      ])
```

y tras `setInvoices(invoicesData)`:

```jsx
      setTestInstances(testData)
```

- [ ] **Step 3: Añadir la tab a la lista**

Modificar `tabs`:

```jsx
  const tabs = [
    { id: 'general', label: 'Información General' },
    { id: 'contact', label: 'Contacto y Dirección' },
    { id: 'medical', label: 'Información Médica' },
    { id: 'tests', label: 'Tests' }
  ]
```

- [ ] **Step 4: Renderizar el contenido de la tab**

Tras el bloque `{activeTab === 'medical' && ( … )}` (justo antes del cierre `</CardContent>` de la Card de tabs), agregar:

```jsx
          {activeTab === 'tests' && (
            <ClientTests
              clientId={id}
              instances={testInstances}
              administeredBy={user?.name}
              canMutate={!client.deletedAt}
              onRefresh={loadClientData}
            />
          )}
```

- [ ] **Step 5: Verify end-to-end (skill `verify`)**

Levantar la app (`npm start`), abrir un cliente, ir a la tab **Tests**, verificar: las 2 tarjetas aparecen ("Sin evaluaciones"), drill-down funciona, "Nueva evaluación" abre el modal, guardar crea la instancia y vuelve, aparece en la lista con puntaje/interpretación, agregar una 2ª muestra el gráfico, editar y borrar funcionan. Confirmar que no hay errores de consola.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(tests): integra tab Tests en el detalle del cliente"
```

---

### Task 7: Paso 4 "Evaluaciones iniciales" en el alta

**Files:**
- Modify: `src/pages/Clients/AddClient.jsx`

**Interfaces:**
- Consumes: `TESTS_CATALOG`, `computeScore`, `getMaxScore` (`testsCatalog`/`testScoring`), `createTestInstance` (`api`), `Select` (ya importado).

- [ ] **Step 1: Imports y catálogo de defaults**

Agregar imports:

```jsx
import { TESTS_CATALOG, getMaxScore } from '../../services/clients/testsCatalog'
import { computeScore } from '../../services/clients/testScoring'
import { createTestInstance } from '../../services/api'
```

Tras las constantes de opciones, agregar:

```js
const DEFAULT_TESTS = TESTS_CATALOG.filter(t => t.defaultOnCreate)
```

- [ ] **Step 2: STEPS dinámico y estado**

Reemplazar la constante `STEPS` por una función y usarla según modo. Cambiar:

```js
const STEPS = [
  { id: 1, title: 'Datos personales y contacto' },
  { id: 2, title: 'Plan y asistencia' },
  { id: 3, title: 'Información médica' }
]
```

por:

```js
const BASE_STEPS = [
  { id: 1, title: 'Datos personales y contacto' },
  { id: 2, title: 'Plan y asistencia' },
  { id: 3, title: 'Información médica' }
]
const TESTS_STEP = { id: 4, title: 'Evaluaciones iniciales' }
```

En el componente, tras `const isEditMode = Boolean(id)`:

```jsx
  const STEPS = isEditMode ? BASE_STEPS : [...BASE_STEPS, TESTS_STEP]
  const LAST_STEP = STEPS[STEPS.length - 1].id
```

En `INITIAL_FORM_DATA` agregar (antes de `clientType`):

```js
  // Evaluaciones iniciales (solo alta): { [testId]: { answers } }
  testInstances: {},
```

- [ ] **Step 3: Reemplazar los `currentStep === 3` de navegación por `LAST_STEP`**

En los botones de navegación, cambiar la condición de submit. Reemplazar:

```jsx
            {currentStep < 3 ? (
              <Button onClick={handleNext}>
                Siguiente
              </Button>
            ) : (
              <Button onClick={handleSubmit} loading={loading}>
                {isEditMode ? 'Guardar cambios' : 'Crear cliente'}
              </Button>
            )}
```

por:

```jsx
            {currentStep < LAST_STEP ? (
              <Button onClick={handleNext}>
                Siguiente
              </Button>
            ) : (
              <Button onClick={handleSubmit} loading={loading}>
                {isEditMode ? 'Guardar cambios' : 'Crear cliente'}
              </Button>
            )}
```

En `handleSubmit`, cambiar `if (!validateStep(3)) return` por `if (!validateStep(LAST_STEP)) return` (validateStep no valida el paso 4, así que devuelve true).

- [ ] **Step 4: Handler de respuestas de test y render del paso 4**

Agregar helper tras `toggleDay`:

```jsx
  const setTestAnswer = (testId, fieldName, value) => {
    setFormData(prev => ({
      ...prev,
      testInstances: {
        ...prev.testInstances,
        [testId]: { answers: { ...(prev.testInstances[testId]?.answers || {}), [fieldName]: value } }
      }
    }))
  }
```

Tras el bloque `{currentStep === 3 && ( … )}` (antes de los botones de navegación), agregar:

```jsx
          {/* Step 4: Evaluaciones iniciales (solo alta) */}
          {currentStep === 4 && (
            <div className="space-y-8">
              <p className="text-sm text-gray-500">
                Opcional. Cargá la evaluación inicial de cada test. Podés dejarlos vacíos y cargarlos después desde el detalle del cliente.
              </p>
              {DEFAULT_TESTS.map(test => {
                const answers = formData.testInstances[test.id]?.answers || {}
                const { rawScore, interpretationLabel, isComplete } = computeScore(test, answers)
                const maxScore = getMaxScore(test)
                const anyAnswered = Object.keys(answers).length > 0
                return (
                  <div key={test.id}>
                    <h3 className="text-lg font-medium text-gray-900 mb-1">{test.name}</h3>
                    <p className="text-sm text-gray-500 mb-4">{test.domain}</p>
                    <div className="space-y-4">
                      {test.fields.map(field => (
                        <Select
                          key={field.name}
                          label={field.label}
                          value={answers[field.name] ?? ''}
                          onChange={e => setTestAnswer(test.id, field.name, e.target.value)}
                          options={[{ value: '', label: 'Seleccionar…' }, ...field.options.map(o => ({ value: o.value, label: `${o.label} (${o.score})` }))]}
                        />
                      ))}
                    </div>
                    {anyAnswered && (
                      <div className="mt-3 bg-indigo-50 rounded-lg p-3 flex items-center justify-between">
                        <span className="text-sm text-indigo-700">Puntaje: <span className="font-bold text-indigo-900">{rawScore}/{maxScore}</span></span>
                        <span className="text-sm font-medium text-indigo-900">{isComplete ? interpretationLabel : 'Incompleto'}</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
```

- [ ] **Step 5: Crear las instancias génesis tras `createClient`**

En `handleSubmit`, dentro de la rama `else` (creación), después de subir avatar/coords y antes de `navigate('/clientes')`, agregar:

```jsx
        // Instancias génesis de los tests completados en el paso 4 (best-effort).
        if (newClient?.id) {
          for (const test of DEFAULT_TESTS) {
            const answers = formData.testInstances[test.id]?.answers || {}
            if (Object.keys(answers).length === 0) continue
            const { rawScore, interpretationLabel, scoreVersion } = computeScore(test, answers)
            await createTestInstance(newClient.id, {
              testId: test.id,
              administeredAt: formData.startDate || new Date().toISOString().split('T')[0],
              administeredBy: user?.name,
              isGenesis: true,
              answers,
              rawScore,
              interpretationLabel,
              scoreVersion
            }).catch(err => console.warn('No se pudo guardar la evaluación inicial:', err))
          }
        }
```

Nota: `useAuth()` ya expone `hasAccess` en este archivo; cambiar `const { hasAccess } = useAuth()` por `const { hasAccess, user } = useAuth()` para tener `user?.name`.

- [ ] **Step 6: Verify end-to-end (skill `verify`)**

`npm start`, alta de cliente: el wizard muestra 4 pasos. En el paso 4 completar Barthel entero y Lawton parcial. Crear. Abrir el cliente → tab Tests: Barthel tiene 1 instancia "Inicial" con puntaje/interpretación; Lawton, si quedó incompleto, se guardó igual (puntaje parcial, sin interpretación) o vacío si no se tocó. Confirmar sin errores de consola. Verificar que en **edición** el wizard sigue teniendo 3 pasos.

- [ ] **Step 7: Compilar Tailwind y commit**

```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
git add src/pages/Clients/AddClient.jsx src/tailwind.output.css
git commit -m "feat(tests): paso 4 de evaluaciones iniciales en el alta"
```

---

## Self-Review

**Spec coverage:**
- Catálogo frontend + scoring → Task 1. ✓
- Tabla genérica `client_test_instances` + RLS + `test_id` sin CHECK → Task 2. ✓
- Motor de scoring puro + tests → Task 1. ✓
- Servicio CRUD + facade → Task 3. ✓
- Paso 4 opcional, génesis post-create, edición sin paso 4, sin tocar RPC → Task 7. ✓
- Tab "Tests" lista + drill-down inline + gráfico SVG + ver/editar/borrar → Tasks 5–6. ✓
- Modal de formulario dinámico con score en vivo → Task 4. ✓
- Carga de instancias en `loadClientData` → Task 6. ✓
- Roles: sin gate (RLS `is_authenticated`, `canMutate` solo por baja) → Tasks 2, 5, 6. ✓
- Snapshot de score/interpretación/versión → Tasks 3, 4, 7. ✓

**Placeholder scan:** sin TBD/TODO; todos los pasos con código real. ✓

**Type consistency:** `computeScore` devuelve `{ rawScore, interpretationLabel, scoreVersion, isComplete }` en todos los usos (Tasks 1,4,7). `Instance` camelCase consistente entre service (Task 3), modal (Task 4) y tab (Task 5). Props de `ClientTests`/`TestInstanceModal` coinciden entre Tasks 4–6. ✓
</content>
</invoke>
