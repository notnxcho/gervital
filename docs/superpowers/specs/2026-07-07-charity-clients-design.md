# Clientes de beneficencia

## Contexto

Se agregan **clientes de beneficencia**: asisten y participan de la operativa (transporte,
grupos, roster de asistencia) pero **no generan costos, facturas ni nada contable**, y **no
impactan el dashboard financiero ni las métricas comerciales**. Sí cuentan en las métricas
de **asistencia** (es operativo, no dinero).

### Decisiones (confirmadas con el usuario)

1. **Asistencia**: los clientes de beneficencia **sí** cuentan en las estadísticas de
   asistencia del dashboard; salen de todo lo financiero y comercial.
2. **Facturas previas al marcarlo**: al marcar un cliente como beneficencia, se **anulan
   (borran) las facturas pendientes sin emitir y sin pagar** de ese cliente; las ya emitidas
   quedan intactas.
3. **Permiso**: solo **admin y superadmin** pueden marcar/desmarcar beneficencia (frontend
   gated por `billing` + guard server-side `is_admin_or_superadmin()` en el RPC).

### Hallazgos del mapeo del código

- **Operativa (incluye beneficencia automáticamente, sin cambios):** transporte
  (`getTransportClients`), grupos (`getClients`) y `dayRoster.js` leen de
  `clients_full`/`getClients` sin acoplamiento contable. Transporte **no tiene pricing
  propio**: se factura dentro de `calculate_month_billing`, así que al no generar factura,
  el transporte tampoco se cobra.
- **Facturación es lazy:** crear un cliente NO genera facturas. Las filas `monthly_invoices`
  se materializan recién al abrir la ficha (`ClientDetail` llama `ensureClientMonths`).
- **Chokepoint contable central:** `calculate_month_billing`; de él cuelgan casi todos los
  agregadores vía CROSS JOIN LATERAL.

## Modelo de datos (migración 041)

- `ALTER TABLE clients ADD COLUMN is_charity BOOLEAN NOT NULL DEFAULT false`.
- `clients_full` (última def. en migración 030): agregar `c.is_charity AS "isCharity"` al
  final (append; `CREATE OR REPLACE VIEW` no reordena columnas existentes).
- **RPCs `create_client_full` / `update_client_full`**: `DROP` de las firmas actuales
  (migración 025) y recrear con un nuevo parámetro final `p_is_charity boolean`.
  - Write con **guard admin-only**:
    - update: `is_charity = CASE WHEN is_admin_or_superadmin() THEN COALESCE(p_is_charity, is_charity) ELSE is_charity END`.
    - create: `CASE WHEN is_admin_or_superadmin() THEN COALESCE(p_is_charity, false) ELSE false END`.
- **RPC nuevo `void_pending_invoices(p_client_id uuid)`** (SECURITY DEFINER, guard
  `is_admin_or_superadmin()`): borra `monthly_invoices` del cliente con
  `invoice_status = 'pending' AND invoiced_at IS NULL AND paid_at IS NULL`.

## Exclusión de agregadores (migración 041, SQL)

Agregar `AND NOT c.is_charity` en:

- `get_dashboard_finance_series` — CTE `live` (join a `clients`).
- `get_month_collection_panel`.
- `get_billing_breakdown_rows`.
- `get_churn_board`.

**NO** se modifica `get_attendance_stats` (asistencia incluye beneficencia).

Cada uno se recrea con `CREATE OR REPLACE FUNCTION` copiando la última versión vigente y
sumando el filtro (no cambian firmas → no hay overloads nuevos).

## Exclusión en frontend

- **`ClientDetail`**: no llamar `ensureClientMonths(id)` si `client.isCharity`. Ocultar
  montos/precios/botones de facturación y cobranza del calendario; mantener el calendario de
  asistencia (operativo). Mostrar badge de beneficencia.
- **`AddClient`** (wizard, paso 2 "Plan y asistencia"): checkbox "Cliente de beneficencia
  (no genera facturación)", visible/editable solo si `hasAccess('billing')`. Si está
  tildado, ocultar el preview de precio. Skip `syncClientToBiller` si es beneficencia.
  Al **editar** y pasar el flag a `true`, llamar `voidPendingInvoices(clientId)` tras el
  update.
- **`ClientList`**: badge "Beneficencia" + entrada de filtro `isCharity` (patrón de
  `MEDICAL_FLAGS` / chip de transporte).
- **`CommercialSection` y `FinanceSection`**: filtrar `!c.isCharity` justo después de
  `getClients({ includeDeleted: true })`, antes de pasar a `commercialStats` / paneles.
- **Badge**: a criterio del implementador, consistente con el sistema (ícono tipo
  corazón/mano solidaria, color violeta del acento de la app).

## Threading del flag

- `clientTransformers.transformClientToDb`: agregar `p_is_charity`.
- `clientTransformers.transformUpdateToDb`: agregar `p_is_charity` condicional.
- `clientTransformers.transformClientFromDb`: pasar `isCharity` (la view ya lo expone).
- `clientService`: `updateClient`/`createClient` ya pasan los params del transformer.

## Servicios nuevos

- `src/services/invoices/invoiceService.js`: `voidPendingInvoices(clientId)` →
  `supabase.rpc('void_pending_invoices', { p_client_id })`. Re-export en `api.js`.

## Testing / verificación

- Verificar en BD (execute_sql): crear cliente charity no materializa facturas; los
  agregadores no lo devuelven; `get_attendance_stats` sí lo cuenta.
- Verificar RPC round-trip del flag vía `clients_full`.
- `npm run build` compila.
- Verificación manual: marcar/desmarcar como admin (aparece/impacta), operador no ve el
  control; transporte y grupos siguen mostrando al cliente.

## Fuera de alcance

- Transporte y grupos: sin cambios (ya incluyen beneficencia).
- No se tocan facturas emitidas.
- `get_attendance_stats` no se filtra.
- `getDashboardMetrics` (KPIs viejos) está fuera de uso en la página actual; si al
  implementar sigue sin usarse, no se toca.
