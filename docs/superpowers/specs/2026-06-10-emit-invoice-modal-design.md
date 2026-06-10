# Modal de confirmación de emisión de factura — Diseño

**Fecha:** 2026-06-10
**Estado:** Aprobado
**Contexto:** Reemplaza el flujo actual de emisión inmediata (botón → `emitInvoice` → `window.alert`) por un modal de confirmación con formulario pre-populado y editable, y vista post-emisión con link al PDF.

## Capacidades de Biller verificadas

- `adenda` — campo propio del comprobante (texto). ✅
- `fecha_emision` / `fecha_vencimiento` — campos del comprobante; el create los acepta. **Decisión:** se envía `fecha_emision` como fecha del CFE (default último día del mes, editable). Riesgo de backdating asumido: si la DGI la rechaza, el error se muestra y la persona corrige la fecha.
- PDF: `GET /v2/comprobantes/pdf?id=<billerId>` devuelve el PDF en **base64** (body). Habilita el "link a la factura".

## Componente: `src/pages/Clients/EmitInvoiceModal.jsx` (nuevo)

ClientDetail.jsx ya es grande → componente separado.

**Props:** `isOpen`, `onClose`, `client`, `year`, `month`, `billing` (resultado de `calculateMonthBilling`), `discountedDays` (array de `Date` con status `vacation` del mes), `invoice` (objeto de `getClientInvoices` para ese mes, puede ya estar emitido), `onRefresh`.

**Modo según `invoice?.billerId`:**

### Modo formulario (sin emitir)
- **Locked (solo lectura):** Nombre completo (`firstName lastName`), Documento (`documentType` + `documentNumber`).
- **Editables, pre-populados (estado local):**
  - `attendanceConcepto` — default `Plan {frequency} días x semana – {turnoLabel}` (turnoLabel: Mañana/Tarde/Día completo).
  - `attendanceAmount` — default `billing.attendanceChargeableGross`. Etiqueta "IVA 22%".
  - `transportConcepto` — default `Transporte`. **Solo si `billing.hasTransport`.**
  - `transportAmount` — default `billing.transportChargeableGross`. Etiqueta "IVA 10%". Solo si hasTransport.
  - `adenda` (textarea) — default: si hay `discountedDays`, `Días no facturados: dd/MM, dd/MM…`; si no, vacío.
  - `fechaEmision` (input date) — default último día del mes (`endOfMonth(new Date(year, month))`).
  - `fechaVencimiento` (input date) — default vacío.
- Acciones: **Emitir** (loading + disabled mientras emite), Cancelar. Error de emisión inline en rojo.
- Al emitir: llama `emitInvoice(clientId, year, month, override)` con el override; en éxito hace `onRefresh()` y pasa a **modo info** (no cierra).

### Modo info (ya emitida)
- Serie-número (`invoice.invoiceNumber`), fecha de emisión, estado DGI con botón "Actualizar" (`checkDgiStatus`).
- **Ver PDF**: `getInvoicePdf` → base64 → blob `application/pdf` → `window.open(URL.createObjectURL(blob))`.
- **Anular** (solo `superadmin`): `voidInvoice` con confirmación; en éxito `onRefresh()` y cierra (vuelve a "Sin factura").

## Backend

### `emit_invoice` (edge) — override opcional
Body suma campos opcionales: `attendanceConcepto`, `attendanceAmount`, `transportConcepto`, `transportAmount`, `adenda`, `fechaEmision`, `fechaVencimiento`.
- El **server fija el IVA por línea** (`indicador_facturacion` 3=22% asistencia, 2=10% transporte) y los `codigo` — el cliente NO puede alterar tasas/códigos.
- Si vienen overrides, se usan concepto/monto provistos y se snapshotea **lo realmente facturado** (`chargeable_amount` = attendanceAmount + transportAmount; gross att/trans = los montos override; net derivado: `round(gross/1.22)` y `round(gross/1.10)`).
- Sin overrides (ej. emisión masiva del dashboard): comportamiento actual (cálculo del server).
- Guard de monto > 0 sobre el total resultante (override o calculado).

### `buildComprobante` (lib) — extensión
Acepta `overrides?: { attendanceConcepto, attendanceAmount, transportConcepto, transportAmount, adenda, fechaEmision, fechaVencimiento }`. Cuando vienen:
- usa concepto/precio override por línea (manteniendo `codigo` e `indicador_facturacion` fijos);
- agrega al comprobante `fecha_emision`, `fecha_vencimiento` (si no vacío), `adenda` (si no vacío).

### `get_invoice_pdf` (edge) — nueva acción
Rol `billing`. Resuelve `biller_id` del mes; `GET /comprobantes/pdf?id=`; devuelve `{ pdf: <base64> }`. 422 si no emitida.

### `billerService.js`
`getInvoicePdf(clientId, year, month)` → `{ pdf }`.

## Integración en ClientDetail.jsx
- Botón "Emitir e-Ticket" del dropdown → abre `EmitInvoiceModal` en modo formulario (ya no emite directo).
- Badge "Facturado" → abre el modal en modo info.
- Se mueven al modal los controles de **DGI (Actualizar)**, **Ver PDF** y **Anular**; se quitan del dropdown para no duplicar. El dropdown de factura queda mínimo (abrir el modal).
- `discountedDays` se deriva de los `attendance_records`/calendario ya cargados (status `vacation` en el mes).

## Errores y casos borde
- Emisión rechazada (incl. backdating de fecha): error inline; la persona ajusta fecha/monto y reintenta (idempotente por `numero_interno`).
- Monto editado a 0 o negativo: bloquear el botón Emitir.
- Cliente sin documento: el modal no debería abrirse en modo formulario (mostrar aviso "cargá la CI"); de todos modos el server lo rechaza con 422.
- PDF no disponible / error: alert con el mensaje.
- Override snapshot: el dashboard refleja lo facturado real (no el cálculo teórico) cuando se editan montos.

## Fuera de alcance
- Edición de la tasa de IVA (fija por tipo de línea).
- Múltiples líneas de plan/transporte (una de cada tipo).
- Almacenar el PDF (se baja on-demand vía base64).
