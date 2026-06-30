# Rediseño del modal de facturación masiva (emisión masiva)

**Fecha:** 2026-06-28
**Estado:** Aprobado

## Problema

El modal de "Facturar mes en bulk" del Dashboard es una caja negra:

1. No expone los settings generales de la corrida (fecha de emisión, fecha de
   vencimiento). Hoy emite con los defaults del server sin pasar `override`.
2. No refleja el estado del proceso. Cuando se facturan ~40 clientes en
   simultáneo (en realidad secuencial con delay de 1.1s), solo se ve un contador
   `done/total` y una lista de fallidos al final. No hay feedback por cliente.

## Objetivo

- Settings generales precargados y editables antes de submitear.
- Status en vivo de cada llamada a la API de Biller, por cliente.
- Reintento de clientes fallidos mostrando el error que devuelve la API.

## Decisiones (acordadas con el usuario)

- **Fecha de emisión** por defecto: **último día hábil del mes facturado**
  (saltando sábado/domingo). Corrige también el default del modal individual,
  que hoy usa `endOfMonth` a secas.
- **Fecha de vencimiento** por defecto: **vacía** (Biller aplica su default).
- Settings **globales** para todo el lote (no override por cliente).
- **Reintento** de fallidas con un botón, mostrando el error de la API por fila.

## Arquitectura

Extraer el modal inline de `Dashboard.jsx` a un componente propio:
`src/pages/Dashboard/BulkInvoiceModal.jsx`.

Props:
- `isOpen`, `onClose`
- `mode`: `'emit' | 'pay'`
- `rows`: candidatos ya filtrados por el Dashboard. Cada uno:
  `{ id, name, transferResponsible, amount, eligibility }`
  donde `eligibility ∈ { 'listo', 'sin CI', 'monto 0' }`.
- `year`, `month`, `monthLabel`
- `onComplete`: callback para que el Dashboard refresque (`load()` + `loadPanel()`).

El Dashboard solo decide **qué** clientes pasar (filtra por `invoiceStatus` /
`paymentStatus` y calcula `eligibility`). El modal maneja todo su estado interno:
settings, progreso, status por fila, reintentos.

Helper compartido nuevo en `src/utils/format.js` (o `src/utils/date.js`):

```js
import { endOfMonth, isWeekend, subDays } from 'date-fns'

// Último día hábil del mes (lun-vie)
export function lastBusinessDayOfMonth(year, month) {
  let d = endOfMonth(new Date(year, month, 1))
  while (isWeekend(d)) d = subDays(d, 1)
  return d
}
```

`EmitInvoiceModal.jsx` pasa a usar este helper para su default de `fechaEmision`.

## Settings globales (solo modo `emit`)

Bloque arriba de la lista:
- **Fecha de emisión** (`<input type="date">`) — precargada con
  `lastBusinessDayOfMonth(year, month)` en formato `yyyy-MM-dd`.
- **Fecha de vencimiento** (`<input type="date">`) — precargada vacía.

Se pasan como override global a cada emisión:
`emitInvoice(id, year, month, { fechaEmision, fechaVencimiento: fechaVencimiento || undefined })`.

En modo `pay` el bloque no se muestra (marcar cobrado no usa fechas).

## Status en vivo por cliente

Cada fila lleva un `runStatus`:

| `runStatus` | Cuándo | Visual |
|---|---|---|
| `idle` | antes de correr | checkbox normal |
| `queued` | seleccionada, esperando turno | badge gris "en cola" |
| `running` | llamada en vuelo | spinner + "emitiendo…" / "cobrando…" |
| `success` | API ok | check verde "emitida" / "cobrada" |
| `error` | API tiró error | badge rojo + mensaje de error inline en la fila |
| `skipped` | no elegible (`sin CI` / `monto 0`) | badge gris, no seleccionable |

El loop sigue **secuencial con delay de 1.1s** (rate-limit de Biller). En vez de
`setProgress({done,total})`:
1. Marca todas las seleccionadas como `queued`.
2. Antes de cada `await`: esa fila → `running`.
3. Según resultado: `success` o `error` (guardando `error.message`).

Header de progreso: barra `X/total` + contadores `✓ N · ✕ M`. Durante la corrida
se deshabilitan search y checkboxes; `onClose` queda bloqueado mientras corre.

## Reintentos

Al terminar, si hay filas `error`:
- Conservan el mensaje de error visible.
- Botón **"Reintentar fallidas (M)"**: resetea esas filas a `queued` y corre el
  mismo loop solo sobre ellas, reusando las fechas globales ya configuradas.
- El botón principal "Emitir seleccionadas" se reemplaza por el de reintento una
  vez que corrió. "Cerrar" llama a `onComplete`.

## Componentes reutilizados

`Modal`, `Button` (con `loading`), `Input` (`type="date"`) de
`src/components/ui/`.

## Verificación

- Unit test del helper `lastBusinessDayOfMonth` (mes que termina en sáb, dom,
  día hábil).
- Build de producción (`npm run build`) sin errores.
- Compilar Tailwind tras cambios de estilo.
- Smoke manual: abrir modal emit, ver settings precargados, correr lote chico,
  ver status por fila, forzar un error y reintentar.
