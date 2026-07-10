# Tests clínicos v2 — resto del catálogo — Diseño

Fecha: 2026-07-10 · Continuación de `2026-07-10-clinical-tests-design.md` (v1: Lawton + Barthel).

## Objetivo

Sumar al catálogo los 8 tests restantes que no dependen de licencia:
**Pfeiffer (SPMSQ), Test del reloj, TMT (A/B), Tinetti (POMA), Berg, TUG, Goldberg (GADS), Yesavage (GDS-15)**.
MMSE y MoCA quedan fuera (copyright, se resuelven aparte).

La infraestructura de v1 (tabla `client_test_instances`, servicio CRUD, tab "Tests", paso 4,
snapshot de score) se reutiliza sin cambios de esquema. Lo que crece es el **motor de scoring**,
el **catálogo**, el **modal dinámico** y la **presentación** en el tab.

## Decisiones de alcance (acordadas)

- **Test del reloj**: incluye subida de imagen del dibujo a Supabase Storage.
- **Escolaridad/edad**: se guardan como datos; la interpretación usa umbrales base (sin ajuste
  fino). Se muestra nota "sin ajuste por escolaridad" donde el spec lo prevé.
- **MMSE/MoCA**: fuera de v2.
- Sin analítica por ítem a nivel población.

## Motor de scoring — extensión (`testScoring.js`)

`computeScore(test, answers)` pasa a devolver:
`{ rawScore, subscores, interpretationLabel, scoreVersion, isComplete }`
donde `subscores` es `{ [subscaleName]: { score, label } } | null`.

Tipos de campo soportados: `enum`, `boolean`, `number`, `image`, `string`, `textarea`.

Dos modos (en `test.scoring.mode`):

### Modo `auto` (suma automática)
`rawScore` = suma sobre los campos `scored`:
- `enum` → `option.score` de la opción elegida.
- `boolean` → `+1` si la respuesta === `field.scoredAnswer` (default `true`). Esto cubre:
  - **Pfeiffer**: cada ítem `scoredAnswer:false` → cuenta errores (respuestas incorrectas).
  - **Goldberg**: `scoredAnswer:true` (suma "sí").
  - **Yesavage**: `scoredAnswer` por ítem (dirección variable — fuente clásica de bugs).
- `number` → valor numérico ingresado (no usado por ningún test `auto` de v2, pero soportado).

**Subescalas**: si hay campos con `field.subscale`, se computa un subtotal por subescala
(`subscores[name].score`) y su interpretación desde `scoring.subscales[].interpretation`.
Tests con subescala: **Tinetti** (equilibrio 0-16 + marcha 0-12; total 0-28) y **Goldberg**
(ansiedad 0-9 corte ≥4; depresión 0-9 corte ≥2; sin total combinado).

`interpretationLabel` (total) se resuelve desde `scoring.interpretation` cuando el test tiene
un total con bandas (Tinetti, Berg, Pfeiffer, Yesavage). Para Goldberg (sin total) es `null` y
la interpretación vive en `subscores`.

`isComplete` = todos los campos `scored` respondidos.

### Modo `manual` (`autoCalculated:false`)
El clínico ingresa el puntaje directo; no se suma de ítems.
- **TUG**: `rawScore` = `answers.tiempo_segundos`; interpretación por bandas de segundos.
- **Test del reloj**: `rawScore` = `answers.puntaje_manual`; interpretación solo si
  `answers.sistema_puntuacion === 'shulman'` (bandas Shulman); si no, `null` (se muestra
  puntaje + sistema).
- **TMT**: sin puntaje único. `subscores` guarda `tmt_a`, `tmt_b` y derivados
  `b_menos_a = b - a`, `ratio_b_a = b / a`. `interpretationLabel` = `null` (se muestra
  referencia gruesa como nota).

`scoring.manualScoreField` nombra el campo que aporta el `rawScore` (TUG/reloj). TMT no lo tiene.

Umbrales de interpretación: transcritos del spec (bandas orientativas), parametrizables por test.

## Catálogo — 8 entradas nuevas (`testsCatalog.js`)

Transcritas del spec JSON provisto (campos, opciones, scores, subescalas, cutoffs, bandas).
`defaultOnCreate: false` en las 8 → no aparecen en el paso 4 del alta (que sigue mostrando solo
Lawton + Barthel); sí aparecen como tarjetas en el tab "Tests" del detalle.

`getMaxScore(test)` se generaliza: enum → max option score; boolean → 1 por ítem scored; para
manual/TMT devuelve `null` (no hay máximo). Subescalas exponen su propio rango vía
`scoring.subscales[].max`.

Campos no puntuados que se guardan: escolaridad, edad, ayuda técnica, variante, sistema de
puntuación, condición, observaciones, flags de discontinuación.

## Storage — imagen del reloj

Bucket `test-attachments` (público de lectura, mismo patrón que `client-avatars`). Helper
`uploadTestAttachment(clientId, testInstanceTempKey, file)` sube y devuelve la URL pública.
En el modal, el campo `image` sube al elegir archivo y guarda la URL en `answers.imagen_dibujo`.
Preview en modo ver/editar. RLS de storage: lectura pública, escritura autenticada.

## Modal dinámico (`TestInstanceModal.jsx`)

Renderer por `field.type`:
- `enum` → `Select` (como v1).
- `boolean` → par de botones Sí/No (o `Select` Sí/No). Para Goldberg, **gating** opcional: los
  ítems 5-9 de cada subescala se muestran atenuados/colapsados hasta cumplir el umbral de
  cribado, pero siempre se pueden registrar (no se bloquean).
- `number` → input numérico con `min`/`max`/`unit`.
- `image` → input file con preview; sube a Storage y setea la URL.
- `textarea`/`string` → `Textarea`/`Input`.

Panel de resultado en vivo: puntaje total (si aplica), subescalas con su interpretación,
derivados (TMT B−A, B/A), o valor manual. "Incompleto" hasta `isComplete`.
Al guardar: snapshot de `rawScore`, `subscores`, `interpretationLabel`, `scoreVersion`.

## Tab "Tests" (`ClientTests.jsx`)

- **Tarjeta**: resumen según forma del test:
  - total → `x/máx · interpretación · fecha`
  - subescalas → `Ansiedad 4/9 · Depresión 2/9`
  - manual → `TUG 14 s` / `Reloj 4/5 (Shulman)`
- **Gráfico de evolución**: grafica el total; si no hay total, la subescala principal (Goldberg →
  depresión) o el valor manual (TUG → segundos). Se omite con <2 instancias.
- Ver/editar/borrar y drill-down inline: sin cambios estructurales.

## Verificación

- **Unit tests del motor** por cada test nuevo, cubriendo lo delicado:
  - Pfeiffer: conteo de errores (scoredAnswer:false), bandas.
  - Yesavage: dirección por ítem (scoredAnswer mixto), banda de corte.
  - Goldberg: dos subescalas independientes con sus cutoffs, sin total.
  - Tinetti: subtotales equilibrio/marcha + total + banda de riesgo.
  - Berg: suma 0-56 + banda.
  - TUG: banda por segundos (bordes 10 / 13.5 / 20).
  - Reloj: banda Shulman solo si sistema=shulman; otro sistema → null.
  - TMT: derivados B−A y B/A, sin banda.
- Build de producción limpio.
- Click-through: cargar una instancia de cada tipo desde el tab y verlas en la lista/gráfico;
  subir imagen en el reloj.
