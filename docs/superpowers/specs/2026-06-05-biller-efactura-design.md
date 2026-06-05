# Integración de Facturación Electrónica — Biller (eFactura Uruguay)

**Fecha:** 2026-06-05
**Estado:** Aprobado (diseño) — pendiente plan de implementación
**Ambiente inicial:** Testing (`test.biller.uy`)

## Objetivo

Integrar Gervital con [Biller](https://biller.uy), proveedor homologado de CFE (DGI Uruguay), para:

1. **Alta automática de receptores**: al crear un cliente en la app se crea su receptor en Biller (biyección 1:1, guardando los IDs de Biller).
2. **Emisión mensual de e-Tickets**: cada cliente recibe un comprobante mensual por su plan de asistencia (+ transporte si corresponde), emitido individualmente desde el detalle de cliente o masivamente desde el dashboard.

## Contexto de la API de Biller

- **Docs**: [colección Postman Biller v2](https://documenter.getpostman.com/view/16327979/UUy1eSan) · [KB facturación por API REST](https://ayuda.biller.uy/es/knowledge/facturaci%C3%B3n-por-api-rest)
- **Auth**: Bearer token estático generado en el panel web. Ambientes separados con token propio:
  - Test: API `https://test.biller.uy/v2/` — token en `https://test.biller.uy/api/tokens` (conectado a DGI homologación; comprobantes sin validez fiscal)
  - Prod: API `https://biller.uy/v2/` — token en `https://biller.uy/api/tokens`
- **Endpoints usados**:
  - `POST /v2/clientes/crear` → devuelve `{cliente, sucursal}` (IDs a persistir)
  - `POST /v2/comprobantes/crear` → e-Ticket `tipo_comprobante=101`; respuesta síncrona `{id, serie, numero, hash}`
  - `GET /v2/comprobantes/obtener` → estado DGI (polling; no hay webhooks)
  - `POST /v2/comprobantes/anular` → anula generando nota de crédito
- **Receptor CI**: `tipo_documento=3`, `documento`, `nombre_fantasia` (≤30), `sucursal: {direccion, ciudad, departamento, pais: "UY", emails: [...]}`. Biller envía el PDF por email automáticamente.
- **Ítems**: inline en el comprobante. `indicador_facturacion`: `3` = IVA 22% (asistencia), `2` = IVA 10% (transporte). `montos_brutos: true` (mandamos precios con IVA incluido — columnas `*_gross` de migración 015).
- **Idempotencia**: `numero_interno` único por ambiente → usamos el `id` de `monthly_invoices`.
- **Rate limit**: 1 req/s para emisión y consultas DGI; errores HTTP estándar (400/403/404/422/429/500).
- **Moneda**: `UYU`.

### Pendientes a confirmar con soporte Biller (no bloquean el build)

- Endpoint/mecanismo para obtener el PDF del comprobante (para `invoice_url`).
- Endpoint de actualización de clientes (la doc pública solo muestra `crear`). Mitigación: re-sync mandando el cliente inline en el próximo comprobante.

## Biyectividad

- **Clientes**: 1 cliente app ↔ 1 receptor Biller, vía `biller_client_id` / `biller_branch_id` persistidos en `clients`.
- **Planes**: biyectividad a nivel de **código de ítem** (no catálogo de Biller — su API de productos solo documenta "cargar", sin update/list, lo que haría frágil un sync bidireccional). Códigos estables derivados del plan vigente del mes:
  - Asistencia: `PLAN-{frequency}-{schedule}` (ej. `PLAN-3-AFTERNOON`)
  - Transporte: `TRANS-{distance_range}-{frequency}` (ej. `TRANS-2_TO_5KM-3`)
  - La app es la única fuente de verdad de precios (versionados por mes, migración 021).

## Arquitectura

**Edge Function `biller`** (patrón `admin-users`: valida rol del caller vía JWT, opera con `service_role`). El token nunca llega al frontend.

Secretos: `BILLER_BASE_URL`, `BILLER_TOKEN`. Pasar de test a prod = cambiar secretos, cero cambios de código.

Body: `{ action, payload }`.

| Acción | Rol mínimo | Comportamiento |
|---|---|---|
| `sync_client` | operador | Crea receptor en Biller (tipo_doc 3, nombre_fantasia, sucursal con dirección + email) y persiste `biller_client_id/branch_id` + `biller_synced_at`. Si ya está sincronizado: no-op. Si falla: persiste `biller_sync_error`. |
| `emit_invoice` | admin (`billing`) | Guards: cliente sincronizado y con CI; invoice con `biller_id IS NULL` (si no → 409); monto > 0. Llama `calculate_month_billing` → arma e-Ticket 101 `montos_brutos: true` con línea asistencia (IVA 22%) + línea transporte (IVA 10%) si aplica. `numero_interno = monthly_invoice.id`. Persiste respuesta vía RPC `mark_invoice_emitted` (atómico): `biller_id/serie/numero/hash`, `invoice_number = "serie-numero"`, `invoice_status='invoiced'`, `dgi_status='pending_dgi'`. |
| `check_dgi_status` | admin | `GET /comprobantes/obtener` → actualiza `dgi_status` (`accepted`/`rejected`) + `dgi_checked_at`. |
| `void_invoice` | superadmin | `POST /comprobantes/anular` → revierte `invoice_status='pending'`, limpia campos Biller, registra anulación en notas. |

- El alta de cliente **nunca se bloquea** por Biller: `createClient` completa y el frontend dispara `sync_client` fire-and-forget; ante fallo queda badge "sin sincronizar" + retry.
- **Emisión masiva**: el frontend itera secuencialmente llamando `emit_invoice` por cliente con ~1.1 s entre llamadas (rate limit), con progreso visible. Evita timeouts de Edge Function y permite retry granular.

## Modelo de datos — Migración 022

**`clients`**:

```sql
ALTER TABLE clients
  ADD COLUMN document_type TEXT NOT NULL DEFAULT 'ci'
    CHECK (document_type IN ('ci', 'rut', 'dni', 'pasaporte', 'otro')),
  ADD COLUMN document_number TEXT,
  ADD COLUMN biller_client_id BIGINT,
  ADD COLUMN biller_branch_id BIGINT,
  ADD COLUMN biller_synced_at TIMESTAMPTZ,
  ADD COLUMN biller_sync_error TEXT;
```

**`monthly_invoices`**:

```sql
ALTER TABLE monthly_invoices
  ADD COLUMN biller_id BIGINT,
  ADD COLUMN biller_serie TEXT,
  ADD COLUMN biller_numero TEXT,
  ADD COLUMN biller_hash TEXT,
  ADD COLUMN dgi_status TEXT CHECK (dgi_status IN ('pending_dgi', 'accepted', 'rejected')),
  ADD COLUMN dgi_checked_at TIMESTAMPTZ,
  ADD COLUMN emit_error TEXT;
```

**RPCs**:
- `create_client_full` / `update_client_full`: agregar params `p_document_type`, `p_document_number`. ⚠️ `DROP FUNCTION` de las firmas anteriores (lección: los overloads se acumulan y rompen con "function is not unique").
- `mark_invoice_emitted(p_client_id, p_year, p_month, p_biller_id, p_serie, p_numero, p_hash)`: persiste respuesta de Biller + `invoice_status='invoiced'` + `invoiced_at=now()` atómicamente.
- Actualizar `clients_full` / `invoices_view` para exponer los campos nuevos.

`invoice_number` existente se llena con `serie-numero` → la UI actual sigue funcionando sin cambios.

## UI

**Alta de cliente (`AddClient.jsx`, paso 1)**
- Campos "Tipo de documento" (select, default CI) y "Número de documento".
- Post-creación: dispara `sync_client` en background sin bloquear el wizard.

**Detalle/edición de cliente (`ClientDetail.jsx`)**
- Campos de documento en el form de edición.
- Chip de estado Biller en el card de resumen: "Sincronizado" / "Sin sincronizar" + botón Reintentar.
- Cambio de datos fiscales (nombre, CI, dirección, email) → re-sync.

**Calendario de facturación (solo feature `billing`)**
- Botón **"Emitir e-Ticket"** por mes: preview (líneas, IVA, total) → confirmar → `emit_invoice` → muestra `serie-numero`.
- Chip de estado DGI por mes con refresh manual (`check_dgi_status`).
- Emisión fallida: muestra `emit_error` + botón reintentar (seguro por idempotencia).
- "Marcar facturado manualmente" pasa a opción secundaria de menú (fallback, no se elimina).
- Anular (superadmin): acción de menú sobre mes emitido → `void_invoice` con confirmación.

**Emisión masiva (Dashboard, feature `billing`)**
- Botón "Emitir facturas del mes" → modal con clientes activos del mes: monto calculado, estado (sin CI / sin sincronizar / ya emitida / monto 0 / lista), checkboxes pre-seleccionando las "listas".
- "Emitir seleccionadas" → secuencial con progreso (`12/34…`); resumen final con retry de fallidas.
- Las filas deshabilitadas muestran el motivo → funciona como checklist de backfill (cargar CI faltantes y sincronizar desde ahí).

## Errores y casos borde

| Caso | Comportamiento |
|---|---|
| Biller caído / timeout en sync | Cliente se crea igual; `biller_sync_error` + badge + retry. |
| Emisión falla (4xx/5xx) | `emit_error` persistido; invoice sigue `pending`; retry seguro por `numero_interno`. |
| Doble emisión | Guard en EF (`biller_id IS NOT NULL` → 409) + `numero_interno` único en Biller. |
| 429 en masiva | 1 retry automático con pausa; si persiste, marca fallida y continúa. |
| DGI rechaza | `dgi_status='rejected'` visible; flujo manual: anular + corregir + re-emitir. |
| Cliente sin email | Se emite igual (e-Ticket no lo requiere); warning en preview (no recibirá el PDF). |
| Monto 0 | No se emite; excluido de la masiva con motivo. |

## Testing y rollout

1. **Pre-requisito (usuario)**: verificar cuenta de la empresa en `test.biller.uy` y generar token de test.
2. **Fase test**: secretos apuntando a test → sincronizar clientes, emitir e-Tickets de prueba, verificar en panel Biller test: receptor, líneas con IVA 22/10, email con PDF, aceptación DGI, anulación.
3. **Verificación de montos**: total del e-Ticket vs `calculate_month_billing` en escenarios: con/sin transporte, días `justified_not_recovered`, plan versionado a mitad de mes, monto overrideado.
4. **Pasaje a prod**: cargar CI de todos los clientes → sync masivo → cambiar secretos a prod → primera emisión masiva supervisada.

## Fuera de alcance (esta iteración)

- Emisión automática programada (cron) — el diseño la permite a futuro.
- e-Factura con RUT (el modelo de datos ya lo soporta vía `document_type`, pero la EF solo emite e-Ticket 101).
- Recibos de pago en Biller (`/v2/recibos`) — el estado de pago sigue siendo interno.
- Descarga/almacenamiento de PDF (pendiente de respuesta de soporte Biller).
