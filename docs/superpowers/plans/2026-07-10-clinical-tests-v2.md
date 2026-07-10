# Clinical Tests v2 Implementation Plan (resto del catálogo)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Sumar 8 tests (Pfeiffer, Reloj, TMT, Tinetti, Berg, TUG, Goldberg, Yesavage) reusando la infra de v1, extendiendo el motor de scoring (boolean/number/subescalas/manual), el modal (renderer por tipo + imagen) y el tab (subescalas/manual).

**Architecture:** Data-driven. El catálogo describe campos y scoring; `computeScore` interpreta modos `auto`/`manual`. Storage para la imagen del reloj. Sin cambios de esquema DB.

**Tech Stack:** React 19, Supabase (Postgres + Storage + RLS), Jest, date-fns.

## Global Constraints

- Igual que v1: inglés en código, español en UI, sin `;`, named exports en servicios.
- No romper v1 (Lawton/Barthel siguen andando; `computeScore` retrocompatible).
- `defaultOnCreate:false` en los 8 → no tocar el paso 4 del alta.
- Umbrales transcritos del spec JSON provisto (bandas orientativas), parametrizables.
- Escolaridad/edad se guardan; interpretación base (sin ajuste).

---

### Task 1: Generalizar el motor de scoring (TDD)

**Files:**
- Modify: `src/services/clients/testScoring.js`
- Modify: `src/services/clients/testsCatalog.js` (solo `getMaxScore`)
- Test: `src/services/clients/testScoringV2.test.js` (nuevo)

**Interfaces:**
- Produces: `computeScore(test, answers) → { rawScore, subscores, interpretationLabel, scoreVersion, isComplete }`
  - `subscores: { [name]: { score, max, label } } | null`
  - Retrocompatible: para tests `auto` sin subescalas devuelve `subscores: null` y el mismo `rawScore`/`interpretationLabel` que v1.

- [ ] **Step 1: Escribir tests** en `testScoringV2.test.js` (usa las entradas de catálogo de la Task 2, así que esta task se implementa junto a la 2 — escribir catálogo primero, luego engine). Casos:

```js
import { computeScore } from './testScoring'
import { getTestById } from './testsCatalog'

test('Pfeiffer cuenta errores (scoredAnswer:false)', () => {
  const t = getTestById('pfeiffer_spmsq')
  // 8 correctas (true), 2 incorrectas (false) → 2 errores
  const answers = { q1_fecha_hoy:true,q2_dia_semana:true,q3_lugar:true,q4_telefono_direccion:true,
    q5_edad:true,q6_fecha_nacimiento:true,q7_presidente_actual:true,q8_presidente_anterior:true,
    q9_apellido_madre:false,q10_resta_seriada:false }
  const r = computeScore(t, answers)
  expect(r.rawScore).toBe(2)
  expect(r.interpretationLabel).toBe('Normal')
})

test('Yesavage respeta dirección por ítem', () => {
  const t = getTestById('yesavage_gds')
  // Responder "deprimido" en todos: q con scoredAnswer=false → responder false; =true → true
  const answers = {}
  t.fields.filter(f => f.scored).forEach(f => { answers[f.name] = f.scoredAnswer })
  const r = computeScore(t, answers)
  expect(r.rawScore).toBe(15)
  expect(r.interpretationLabel).toBe('Depresión severa')
})

test('Goldberg: dos subescalas independientes, sin total', () => {
  const t = getTestById('goldberg')
  const answers = {}
  t.fields.forEach(f => { answers[f.name] = f.subscale === 'ansiedad' })  // ansiedad todo sí, depresión todo no
  const r = computeScore(t, answers)
  expect(r.rawScore).toBeNull()
  expect(r.subscores.ansiedad.score).toBe(9)
  expect(r.subscores.depresion.score).toBe(0)
  expect(r.subscores.ansiedad.label).toMatch(/probable/i)
})

test('Tinetti: subtotales + total + banda', () => {
  const t = getTestById('tinetti')
  const answers = {}
  t.fields.forEach(f => { answers[f.name] = String(Math.max(...f.options.map(o => o.score))) })
  const r = computeScore(t, answers)
  expect(r.subscores.equilibrio.score).toBe(16)
  expect(r.subscores.marcha.score).toBe(12)
  expect(r.rawScore).toBe(28)
  expect(r.interpretationLabel).toMatch(/bajo/i)
})

test('Berg suma 0-56', () => {
  const t = getTestById('berg')
  const answers = {}
  t.fields.forEach(f => { answers[f.name] = '4' })
  expect(computeScore(t, answers).rawScore).toBe(56)
})

test('TUG banda por segundos', () => {
  const t = getTestById('tug')
  expect(computeScore(t, { tiempo_segundos: 8 }).interpretationLabel).toMatch(/Normal/i)
  expect(computeScore(t, { tiempo_segundos: 15 }).interpretationLabel).toMatch(/riesgo/i)
})

test('Reloj: banda Shulman solo si sistema=shulman', () => {
  const t = getTestById('test_reloj')
  expect(computeScore(t, { puntaje_manual: 5, sistema_puntuacion: 'shulman' }).interpretationLabel).toMatch(/Normal/i)
  expect(computeScore(t, { puntaje_manual: 2, sistema_puntuacion: 'moca_cdt' }).interpretationLabel).toBeNull()
})

test('TMT derivados sin banda', () => {
  const t = getTestById('tmt')
  const r = computeScore(t, { tmt_a_segundos: 30, tmt_b_segundos: 90 })
  expect(r.subscores.b_menos_a.score).toBe(60)
  expect(r.subscores.ratio_b_a.score).toBeCloseTo(3)
  expect(r.interpretationLabel).toBeNull()
})
```

- [ ] **Step 2: Reemplazar `computeScore`** en `testScoring.js`:

```js
// Motor de scoring. answers = { [fieldName]: value } (enum→optionValue, boolean→bool, number→num).
export function computeScore(test, answers = {}) {
  const scoring = test.scoring || {}
  const mode = scoring.mode || 'auto'
  return mode === 'manual' ? computeManual(test, answers) : computeAuto(test, answers)
}

function bandLabel(bands, value) {
  if (!bands || value == null) return null
  const b = bands.find(x => value >= x.min && value <= x.max)
  return b ? b.label : null
}

// Aporte de un campo scored al puntaje.
function fieldScore(field, value) {
  if (value == null || value === '') return null
  if (field.type === 'enum') {
    const o = field.options.find(op => op.value === value)
    return o ? o.score : null
  }
  if (field.type === 'boolean') {
    const target = field.scoredAnswer ?? true
    return value === target ? 1 : 0
  }
  if (field.type === 'number') {
    const n = Number(value)
    return Number.isNaN(n) ? null : n
  }
  return null
}

function computeAuto(test, answers) {
  const scored = test.fields.filter(f => f.scored)
  let total = 0
  let answered = 0
  const subAgg = {}
  for (const field of scored) {
    const s = fieldScore(field, answers[field.name])
    if (s == null) continue
    answered += 1
    total += s
    if (field.subscale) subAgg[field.subscale] = (subAgg[field.subscale] || 0) + s
  }
  const isComplete = answered === scored.length
  // Subescalas (si el test las define)
  let subscores = null
  if (scoring(test).subscales) {
    subscores = {}
    for (const sub of scoring(test).subscales) {
      const score = subAgg[sub.name] || 0
      subscores[sub.name] = { score, max: sub.max, label: isComplete ? bandLabel(sub.interpretation, score) : null }
    }
  }
  // Total: solo si el test tiene bandas de total (los de solo-subescala como Goldberg → null)
  const hasTotal = Boolean(scoring(test).interpretation) || scoring(test).producesTotal
  const rawScore = hasTotal ? total : null
  const interpretationLabel = hasTotal && isComplete ? bandLabel(scoring(test).interpretation, total) : null
  return { rawScore, subscores, interpretationLabel, scoreVersion: scoring(test).scoreVersion, isComplete }
}

function computeManual(test, answers) {
  const sc = scoring(test)
  // TMT: sin puntaje único; derivados en subscores.
  if (test.id === 'tmt') {
    const a = num(answers.tmt_a_segundos), b = num(answers.tmt_b_segundos)
    const subscores = {
      tmt_a: { score: a, max: null, label: null },
      tmt_b: { score: b, max: null, label: null },
      b_menos_a: { score: a != null && b != null ? b - a : null, max: null, label: null },
      ratio_b_a: { score: a ? b / a : null, max: null, label: null }
    }
    return { rawScore: null, subscores, interpretationLabel: null, scoreVersion: sc.scoreVersion, isComplete: a != null && b != null }
  }
  const value = num(answers[sc.manualScoreField])
  const isComplete = value != null
  // Reloj: banda solo para Shulman.
  if (test.id === 'test_reloj') {
    const label = isComplete && answers.sistema_puntuacion === 'shulman' ? bandLabel(sc.interpretation, value) : null
    return { rawScore: value, subscores: null, interpretationLabel: label, scoreVersion: sc.scoreVersion, isComplete }
  }
  const label = isComplete ? bandLabel(sc.interpretation, value) : null
  return { rawScore: value, subscores: null, interpretationLabel: label, scoreVersion: sc.scoreVersion, isComplete }
}

const scoring = (test) => test.scoring || {}
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isNaN(n) ? null : n }
```

- [ ] **Step 3: Generalizar `getMaxScore`** en `testsCatalog.js`:

```js
// Máximo puntaje del total (null si el test no tiene total sumable: manual/TMT/solo-subescalas).
export function getMaxScore(test) {
  const sc = test.scoring || {}
  if (sc.mode === 'manual') return null
  if (!sc.interpretation && !sc.producesTotal) return null // solo-subescalas (Goldberg)
  return test.fields.filter(f => f.scored).reduce((sum, f) => {
    if (f.type === 'enum') return sum + Math.max(...f.options.map(o => o.score))
    if (f.type === 'boolean') return sum + 1
    return sum
  }, 0)
}
```

- [ ] **Step 4: Correr tests** `CI=true npx react-scripts test src/services/clients/ --watchAll=false`. Esperar: v1 (`testScoring.test.js`) + v2 en verde.

- [ ] **Step 5: Commit** `git commit -m "feat(tests): motor de scoring boolean/number/subescalas/manual"`

---

### Task 2: Catálogo — 8 entradas nuevas

**Files:** Modify `src/services/clients/testsCatalog.js`

Agregar al array `TESTS_CATALOG` (después de barthel) las 8 entradas, transcritas del spec JSON
provisto. Convenciones por test:

- **pfeiffer_spmsq**: 10 fields `boolean` `scored:true` `scoredAnswer:false` (q1..q10) + `escolaridad` enum `scored:false`. `scoring: { mode:'auto', scoreVersion:'pfeiffer_10', interpretation:[{0,2,'Normal'},{3,4,'Deterioro cognitivo leve'},{5,7,'Deterioro cognitivo moderado'},{8,10,'Deterioro cognitivo severo'}] }`.
- **test_reloj**: fields `condicion`(enum,no scored), `imagen_dibujo`(image,no scored), `puntaje_manual`(number,scored:false — el score sale del modo manual), `sistema_puntuacion`(enum,no scored: shulman/moca_cdt/sunderland/rouleau), `observaciones`(textarea). `scoring:{ mode:'manual', manualScoreField:'puntaje_manual', scoreVersion:'reloj_shulman', interpretation:[{0,0,'Incapaz de representar un reloj'},{1,3,'Alteración moderada-severa'},{4,4,'Errores menores'},{5,5,'Normal'}] }`.
- **tmt**: fields `tmt_a_segundos`(number,scored:false),`tmt_a_errores`(number,no),`tmt_a_discontinuado`(boolean,no),`tmt_b_segundos`(number),`tmt_b_errores`,`tmt_b_discontinuado`,`escolaridad_anios`(number,no),`observaciones`(textarea). `scoring:{ mode:'manual', scoreVersion:'tmt_ab' }` (sin manualScoreField ni interpretation).
- **tinetti**: 9 fields subscale `equilibrio` + 7 fields subscale `marcha`, todos enum scored (valores/scores del spec). `scoring:{ mode:'auto', producesTotal:true, scoreVersion:'tinetti_28', subscales:[{name:'equilibrio',label:'Equilibrio',max:16,interpretation:null},{name:'marcha',label:'Marcha',max:12,interpretation:null}], interpretation:[{25,28,'Riesgo de caídas bajo'},{19,24,'Riesgo de caídas moderado'},{0,18,'Riesgo de caídas alto'}] }`.
- **berg**: 14 fields enum 0-4 (options value '0'..'4' score 0..4). `scoring:{ mode:'auto', scoreVersion:'berg_56', interpretation:[{41,56,'Bajo riesgo / marcha independiente'},{21,40,'Riesgo medio / marcha con asistencia'},{0,20,'Alto riesgo / dependiente'}] }`.
- **tug**: fields `tiempo_segundos`(number,scored:false),`ayuda_tecnica`(enum,no),`variante`(enum,no),`observaciones`(textarea). `scoring:{ mode:'manual', manualScoreField:'tiempo_segundos', scoreVersion:'tug_seg', interpretation:[{0,9.99,'Normal / movilidad conservada'},{10,13.49,'Intermedio'},{13.5,19.99,'Mayor riesgo de caídas'},{20,9999,'Deterioro de movilidad marcado'}] }`.
- **goldberg**: 9 fields subscale `ansiedad` + 9 subscale `depresion`, `boolean scored:true scoredAnswer:true`, con `screening:true/false` por ítem (spec). `scoring:{ mode:'auto', scoreVersion:'gads_18', subscales:[{name:'ansiedad',label:'Ansiedad',max:9,interpretation:[{0,3,'Ansiedad: poco probable'},{4,9,'Ansiedad: probable caso'}]},{name:'depresion',label:'Depresión',max:9,interpretation:[{0,1,'Depresión: poco probable'},{2,9,'Depresión: probable caso'}]}] }` (SIN `interpretation` de total → total null).
- **yesavage_gds**: 15 fields boolean scored:true con `scoredAnswer` por ítem (del spec: q1 false, q2 true, q3 true, q4 true, q5 false, q6 true, q7 false, q8 true, q9 true, q10 true, q11 false, q12 true, q13 false, q14 true, q15 true). `scoring:{ mode:'auto', scoreVersion:'gds15', interpretation:[{0,4,'Normal / sin depresión'},{5,8,'Depresión leve'},{9,11,'Depresión moderada'},{12,15,'Depresión severa'}] }`.

Todas `defaultOnCreate:false`, con `name` y `domain` del spec.

- [ ] **Step 1:** Escribir las 8 entradas (transcripción de campos/opciones desde el spec JSON).
- [ ] **Step 2:** Correr los tests de Task 1 (dependen de este catálogo). Verde.
- [ ] **Step 3: Commit** `git commit -m "feat(tests): 8 entradas de catálogo (Pfeiffer, Reloj, TMT, Tinetti, Berg, TUG, Goldberg, Yesavage)"`

(Tasks 1 y 2 se commitean juntas si conviene; el orden real de escritura es catálogo→engine porque los tests referencian el catálogo.)

---

### Task 3: Storage para imagen del reloj

**Files:**
- Create: `supabase/migrations/059_test_attachments_bucket.sql`
- Create: `src/services/clients/testAttachmentService.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Migración** crea el bucket y políticas (mirror de `client-avatars`):

```sql
-- 059_test_attachments_bucket.sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('test-attachments', 'test-attachments', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "test_attach_read" ON storage.objects;
DROP POLICY IF EXISTS "test_attach_write" ON storage.objects;
DROP POLICY IF EXISTS "test_attach_update" ON storage.objects;
DROP POLICY IF EXISTS "test_attach_delete" ON storage.objects;
CREATE POLICY "test_attach_read"   ON storage.objects FOR SELECT USING (bucket_id = 'test-attachments');
CREATE POLICY "test_attach_write"  ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'test-attachments' AND auth.role() = 'authenticated');
CREATE POLICY "test_attach_update" ON storage.objects FOR UPDATE USING (bucket_id = 'test-attachments' AND auth.role() = 'authenticated');
CREATE POLICY "test_attach_delete" ON storage.objects FOR DELETE USING (bucket_id = 'test-attachments' AND auth.role() = 'authenticated');
```

Aplicar vía MCP `apply_migration`. (Ajustar las policies al patrón real de `client-avatars` tras leer `clientAvatarService.js` / la migración 011.)

- [ ] **Step 2: Servicio** `testAttachmentService.js`:

```js
import { supabase } from '../supabase/client'

const BUCKET = 'test-attachments'

// Sube una imagen y devuelve su URL pública. path = clientId/timestamp-filename.
export async function uploadTestAttachment(clientId, file) {
  const ext = file.name.split('.').pop()
  const path = `${clientId}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false })
  if (error) throw new Error(error.message)
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}
```

Re-export en `api.js`: `export { uploadTestAttachment } from './clients/testAttachmentService'`.

- [ ] **Step 3: Commit** `git commit -m "feat(tests): bucket + servicio de adjuntos (imagen del reloj)"`

---

### Task 4: Modal dinámico por tipo de campo + imagen

**Files:** Modify `src/pages/Clients/TestInstanceModal.jsx`

- [ ] **Step 1:** Extraer un componente `FieldInput` que renderiza según `field.type`:
  - `enum` → `Select` (como hoy).
  - `boolean` → dos botones "Sí"/"No" (toggle a `true`/`false`), con estado visible; disabled en readOnly.
  - `number` → `<input type="number" min max>` + unidad (`field.unit`).
  - `image` → input file; al elegir, `uploadTestAttachment(clientId, file)`, guarda URL en answer, muestra preview; en readOnly muestra la imagen.
  - `textarea`/`string` → `Textarea`/`Input`.

  Gating Goldberg: si `field.screening === false` y su subescala no superó el umbral de cribado
  (`ansiedad` ≥2 en screening / `depresion` ≥1), renderizar el campo atenuado (opacity + hint),
  pero funcional.

- [ ] **Step 2:** Panel de resultado en vivo generalizado: mostrar `rawScore/maxScore` si hay total;
  subescalas (`subscores`) con su label; derivados TMT; o "Incompleto". Usar `computeScore`.

- [ ] **Step 3:** Al guardar, snapshot `rawScore`, `subscores`, `interpretationLabel`, `scoreVersion`
  (el service ya acepta `subscores`).

- [ ] **Step 4:** Build (`CI=true npm run build`) verde. **Commit** `git commit -m "feat(tests): modal con renderer por tipo de campo + imagen"`

---

### Task 5: Tab "Tests" — resumen y gráfico por forma del test

**Files:** Modify `src/pages/Clients/ClientTests.jsx`

- [ ] **Step 1:** Helper `summarize(test, instance)` que devuelve el texto de resumen:
  - total → `${rawScore}/${maxScore} · ${interpretationLabel}`
  - subescalas → juntar `${sub.label} ${sub.score}/${sub.max}` (ej. Goldberg)
  - manual → `${rawScore} ${unidad}` (TUG "s") o `${rawScore}/5 (${sistema})` (reloj)
  Usar `subscores`/`rawScore` snapshoteados en la instancia (no recomputar).

- [ ] **Step 2:** `ScoreTrend`: elegir la serie — total si existe; si no, subescala principal
  (`depresion` para Goldberg) o valor manual (TUG segundos). `maxScore` acorde (o autoescala si null).

- [ ] **Step 3:** Build verde. **Commit** `git commit -m "feat(tests): tab soporta subescalas y tests manuales"`

---

### Task 6: Verificación end-to-end (skill `verify`)

- [ ] `npm start`, abrir un cliente → tab Tests: aparecen las 10 tarjetas.
- [ ] Cargar una instancia de cada forma: Pfeiffer (boolean), Tinetti (subescalas + total),
  Goldberg (2 subescalas), TUG (manual segundos), Reloj (manual + imagen subida), TMT (derivados),
  Berg, Yesavage.
- [ ] Verificar resumen correcto en la lista, gráfico de evolución con 2+ instancias, editar/borrar,
  y que Lawton/Barthel (v1) siguen andando.
- [ ] `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css` y commit final.

---

## Self-Review

**Spec coverage:** motor auto/manual/subescalas/boolean/number (T1) ✓ · 8 catálogo (T2) ✓ ·
imagen reloj + storage (T3) ✓ · modal renderer por tipo (T4) ✓ · tab subescalas/manual (T5) ✓ ·
escolaridad/edad guardadas sin ajuste (T2 campos no scored) ✓ · verificación (T6) ✓.

**Placeholder scan:** el engine, getMaxScore, storage y service van con código completo. La
transcripción de campos del catálogo se hace desde el spec JSON provisto (fuente única), con el
scoring-config exacto pinneado por test en T2.

**Type consistency:** `computeScore` retorna `{rawScore, subscores, interpretationLabel,
scoreVersion, isComplete}` en engine (T1), modal (T4) y summarize (T5). `subscores[name] =
{score,max,label}` consistente. `getMaxScore` puede devolver `null` → T4/T5 lo contemplan.
