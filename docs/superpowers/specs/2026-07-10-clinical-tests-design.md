# Módulo de tests clínicos — Diseño

Fecha: 2026-07-10

## Objetivo

Registrar **evaluaciones clínicas** (tests geriátricos) por cliente, con **temporalidad**:
un mismo test se toma varias veces a lo largo del tiempo y se quiere ver su evolución.

Un test tiene una definición fija (ítems, cómo puntúa, cómo se interpreta). Cada vez que se
toma se genera una **instancia** con fecha, respuestas por ítem, puntaje e interpretación.

## Alcance v1

Solo los **2 tests obligatorios** del catálogo (`defaultOnCreate: true`):

- **Lawton & Brody (IADL)** — funcional instrumental. 8 ítems enum ordinales, 0–8. Versión
  **unisex** (se puntúan los 8 ítems en todos, sin el corte por sexo de 1969).
- **Índice de Barthel (ABVD)** — funcional básico. 10 ítems enum ponderados (0/5/10/15), 0–100.

Ambos comparten la misma forma: N ítems ordinales → **suma automática** → bandas de
interpretación. Sin subescalas, sin adjuntos, sin campos manuales, sin copyright.

El modelo es **genérico**: sumar cualquiera de los otros 10 tests después es agregar una
entrada al catálogo de frontend (+ eventualmente activar features que hoy no se implementan:
subescalas, adjuntos, campos manuales, ajustes por escolaridad). No requiere migración de DB.

**Fuera de alcance v1 (YAGNI):** MMSE/MoCA (copyright), subescalas (Goldberg/Tinetti),
tiempos sin suma (TUG/TMT), adjuntos de imagen (test del reloj), ajustes por
escolaridad/edad, analítica por ítem a nivel población.

## Modelo de datos

### Catálogo (frontend) — `src/services/clients/testsCatalog.js`

Constante `TESTS_CATALOG` (mismo patrón que `medicalConstants.js` / `transportConstants.js`).
Fuente de verdad de la definición y el scoring. Cada test:

```
{
  id, name, domain, defaultOnCreate,
  fields: [ { name, label, type, scored, options?[{value,label,score}], selection?, note? } ],
  scoring: {
    producesScore, autoCalculated, method, range, scoreVersion,
    interpretation: [ { min, max, label } ]
  }
}
```

En v1 solo `lawton_brody` y `barthel` (todos los `fields` son `enum single scored`).
Los umbrales de interpretación son datos del spec, **parametrizables** (no hardcodeados en la
lógica). Se transcriben tal cual del spec provisto (bandas orientativas).

### Instancias (DB) — migración `058_client_test_instances.sql`

Una sola tabla genérica:

```
client_test_instances
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid()
  client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE
  test_id             text NOT NULL          -- validado contra catálogo en frontend; SIN CHECK
  administered_at     date NOT NULL          -- fecha de la toma
  administered_by     text                   -- nombre del usuario que la cargó
  is_genesis          boolean NOT NULL DEFAULT false  -- true = evaluación inicial del alta
  answers             jsonb NOT NULL DEFAULT '{}'      -- { field_name: value }
  raw_score           numeric                -- snapshot del puntaje calculado
  subscores           jsonb                  -- reservado para tests con subescalas (v1: null)
  interpretation_label text                  -- snapshot de la banda
  score_version       text                   -- variante de scoring usada (auditoría)
  notes               text
  created_at          timestamptz NOT NULL DEFAULT now()
  updated_at          timestamptz NOT NULL DEFAULT now()

INDEX idx_client_test_instances_client_test ON (client_id, test_id, administered_at DESC)
```

**Decisiones deliberadas:**
- `test_id` **sin `CHECK`**: el objetivo del modelo genérico es crecer el catálogo sin migrar.
  Se valida en frontend contra `TESTS_CATALOG`. (Se aparta del patrón de CHECK del repo a
  propósito, por este objetivo.)
- Respuestas en **una columna `jsonb`**, no en una tabla key-value aparte. El caso de uso es
  "cargar el formulario y ver la evolución del puntaje total"; la tabla key-value solo se
  justifica para analítica por ítem a nivel población, que no aplica.
- `raw_score` / `interpretation_label` / `score_version` se **snapshotean** al guardar. Si el
  spec cambia sus umbrales después, las instancias viejas conservan lo que se calculó entonces.

**RLS:** espeja las tablas médicas (`client_medications`, etc.): `is_authenticated()` para
SELECT/INSERT/UPDATE/DELETE. Todos los roles (operador/admin/superadmin), igual que la ficha
médica —que hoy no tiene gate por rol—. Los tests no son dato financiero.

## Motor de scoring (puro) — `src/services/clients/testScoring.js`

`computeScore(test, answers)` → `{ rawScore, interpretationLabel, scoreVersion, isComplete }`

- `rawScore`: suma del `score` de la opción elegida en cada `field.scored`.
- `isComplete`: todos los campos `scored` tienen respuesta.
- `interpretationLabel`: banda de `scoring.interpretation` cuyo `[min,max]` contiene `rawScore`
  (solo cuando `isComplete`; si no, `null`).
- `scoreVersion`: copiado de `scoring.scoreVersion`.

Función pura, sin dependencias de React/DB. **Cubierta con tests unitarios** (Jest, ya
configurado por CRA): ambos tests, respuestas completas/incompletas y bandas de borde.

## Capa de servicio — `src/services/clients/testInstanceService.js`

- `getClientTestInstances(clientId)` → instancias del cliente (camelCase, orden por
  `administered_at DESC`).
- `createTestInstance(clientId, payload)` → inserta.
- `updateTestInstance(id, payload)` → actualiza (setea `updated_at`).
- `deleteTestInstance(id)` → borra.

`payload = { testId, administeredAt, administeredBy, isGenesis, answers, rawScore, subscores,
interpretationLabel, scoreVersion, notes }`. Re-exportado por `src/services/api.js`.

## UI — Alta de cliente (`AddClient.jsx`)

Nuevo **paso 4 "Evaluaciones iniciales"**, solo en alta (en edición `STEPS` se queda en 3;
las instancias se gestionan desde el detalle).

- Renderiza los tests `defaultOnCreate` como bloques colapsables, **opcionales**.
- Cada bloque: date picker de la toma (default = fecha de ingreso del cliente) + el formulario
  dinámico del test + puntaje/interpretación en vivo.
- `INITIAL_FORM_DATA.testInstances = {}` — `{ [testId]: { administeredAt, answers } }`.
- En `handleSubmit` (solo alta): tras `createClient`, por cada test **completado**,
  `computeScore` + `createTestInstance(is_genesis: true)`. Best-effort, después del create
  (como avatar/coords) → **no se toca `create_client_full`** (evita overload accumulation).

## UI — Detalle de cliente (`ClientDetail.jsx`)

Nueva tab **`Tests`** (5ª, después de Médica). Se carga `getClientTestInstances(id)` dentro de
`loadClientData` (junto a recovery credits).

Componente `ClientTests` (archivo propio, `src/pages/Clients/ClientTests.jsx`):

1. **Vista lista** (default): una tarjeta por test del catálogo. Muestra último puntaje
   (`X/máx`), interpretación y fecha, o "Sin evaluaciones". Botón "Nueva evaluación" por
   tarjeta.
2. **Drill-down inline** (al hacer clic en una tarjeta; con "← Volver", sin modal anidado):
   - Título + dominio del test.
   - Mini-gráfico SVG de puntaje en el tiempo (mismo enfoque pure-SVG que
     `MonthlyFinanceChart`). Se omite si hay <2 instancias.
   - Lista de instancias (más reciente primero): fecha, `administered_by`, puntaje `X/máx`,
     badge de interpretación, badge "Inicial" si `is_genesis`. Acciones: **ver / editar /
     borrar** (borrar con confirmación).
   - Botón "Nueva evaluación".
3. `TestInstanceModal` (`src/pages/Clients/TestInstanceModal.jsx`): formulario dinámico desde
   el spec (enums como radios/select) + date picker, con puntaje e interpretación **en vivo**.
   Modos crear / editar / ver (read-only). Al guardar: `computeScore` + create/update, luego
   `onRefresh`.

## Componentes reutilizados / nuevos

- Nuevo: `testsCatalog.js`, `testScoring.js` (+ test), `testInstanceService.js`,
  `ClientTests.jsx`, `TestInstanceModal.jsx`, migración 058.
- Reutiliza: `Modal`, `Button`, `Input/Select`, `Tabs`, `Card`, patrón de tooltips/badges.

## Verificación

- Unit tests del motor de scoring (bandas de borde de ambos tests).
- Flujo real end-to-end (skill `verify`): crear cliente con evaluación inicial de ambos tests,
  ver la tab Tests, agregar una 2ª instancia de un test, ver el gráfico de evolución, editar y
  borrar una instancia.
