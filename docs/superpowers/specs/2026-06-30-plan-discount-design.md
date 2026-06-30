# Promociones / Descuento sobre el plan — Diseño

**Fecha:** 2026-06-30
**Estado:** Aprobado (pendiente implementación)

## Objetivo

Permitir aplicar un descuento porcentual sobre el **plan de asistencia** de un cliente
a un rango **consecutivo** de meses **no cobrados ni facturados**, como contrapartida de
un pago por adelantado. El descuento afecta **solo la asistencia**; el transporte queda
intacto.

## Reglas de negocio

1. El descuento se aplica a un rango de meses `[inicio, fin]` con **mínimo 2 meses distintos**.
2. El rango debe ser **consecutivo** (sin huecos) y **todos** sus meses deben estar
   `payment_status = 'pending'` **y** `invoice_status = 'pending'`.
3. El porcentaje (1–100) reduce únicamente la porción de **asistencia** (net y gross).
   El transporte no se modifica.
4. La promoción es **reversible**: se puede ver (badge por mes) y quitar/re-aplicar
   mientras los meses sigan sin cobrar ni facturar.
5. Al **facturar** (flujo normal, último día hábil del mes), el concepto de asistencia
   incluye el sufijo `(X% dto)` y el monto ya viene descontado.
6. El descuento solo lo aplican roles con feature `billing` (admin / superadmin).

## Enfoque elegido (A): columna `discount_percent` en `monthly_invoices`

El descuento vive por mes en la fila de `monthly_invoices`. El cálculo de facturación
(`calculate_month_billing`) lo aplica sobre la asistencia. El snapshot existente al cobrar
y al facturar hereda automáticamente los montos descontados. Quitar la promo = volver el
porcentaje a 0.

## Modelo de datos

Migración nueva: `029_plan_discount.sql`.

```sql
ALTER TABLE monthly_invoices
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0
  CHECK (discount_percent >= 0 AND discount_percent <= 100);
```

## Cálculo: `calculate_month_billing`

Se modifica la función (último `CREATE OR REPLACE` está en `015_pricing_redesign.sql`,
firma `(p_client_id, p_year, p_month)`, `SECURITY DEFINER`). Cambios:

1. Leer el descuento de la fila del mes:
   ```sql
   SELECT COALESCE(discount_percent, 0) INTO v_discount
   FROM monthly_invoices
   WHERE client_id = p_client_id AND year = p_year AND month = p_month;
   v_discount := COALESCE(v_discount, 0);
   v_discount_factor := 1 - v_discount / 100.0;
   ```
2. Aplicar `v_discount_factor` **solo** a la asistencia cobrable, después del prorrateo:
   ```sql
   v_att_charge_gross := ROUND(v_proration_factor * v_att_rate_gross * v_discount_factor);
   v_att_charge_net   := ROUND(v_proration_factor * v_att_rate_net   * v_discount_factor);
   ```
   `v_trans_charge_*` queda sin cambios.
3. Los `attendanceMonthlyRate*` (precio "sticker"/potencial) **no** se descuentan — solo
   el `attendanceChargeable*`. Así el detalle muestra potencial vs. cobrable con descuento.
4. `totalChargeableGross` y `chargeableAmount` se recomponen con asistencia descontada +
   transporte intacto (la suma ya usa las variables, queda automático).
5. Agregar al `jsonb_build_object` de retorno: `'discountPercent', v_discount`.

Como `mark_month_paid` y el snapshot al emitir (`mark_invoice_emitted` con sus params)
toman sus valores de `calculate_month_billing`, heredan el descuento sin tocar sus firmas.

## RPC de aplicación: `apply_plan_discount`

Nueva función en la migración (`SECURITY DEFINER`):

```sql
apply_plan_discount(
  p_client_id UUID,
  p_start_year INTEGER, p_start_month INTEGER,   -- month 0-indexed
  p_end_year INTEGER,   p_end_month INTEGER,
  p_percent NUMERIC
) RETURNS JSONB
```

Lógica:
- Normaliza el rango a un índice ordinal `year*12 + month` para inicio y fin.
- Valida:
  - `p_percent` entre 0 y 100 (0 = quitar promo).
  - rango con **≥ 2 meses** (`end_ordinal > start_ordinal`).
  - **todos** los meses del rango tienen fila en `monthly_invoices` y están
    `payment_status='pending'` AND `invoice_status='pending'`. Si falta una fila o alguno
    no cumple → `RETURN jsonb_build_object('success', false, 'error', '…')`.
- `UPDATE monthly_invoices SET discount_percent = p_percent, updated_at = now()` para
  todas las filas del rango (ordinal entre start y end).
- Retorna `{ success: true, monthsUpdated: N }`.

Quitar promo: misma función con `p_percent = 0` sobre el mismo rango.

`invoices_view` ya hace `SELECT *`-style por columnas; agregar
`mi.discount_percent AS "discountPercent"` a la vista (definición vigente en
`022_biller_integration.sql`).

## Capa de servicio (`src/services/invoices/invoiceService.js`)

- `applyPlanDiscount(clientId, startYear, startMonth, endYear, endMonth, percent)` →
  `supabase.rpc('apply_plan_discount', {...})`, lanza error si `!data.success`.
- `removePlanDiscount(clientId, startYear, startMonth, endYear, endMonth)` →
  llama `applyPlanDiscount` con `percent = 0`.
- En `getClientInvoices`/`calculateMonthBilling` mapear `discountPercent`
  (`Number(inv.discountPercent) || 0`).
- Re-export en `src/services/api.js`.

## UI

### Entrada
En el header del detalle del cliente (`ClientDetail.jsx`), dentro del menú de opciones
(`MoreVert`, donde está "Dar de baja"), agregar **"Aplicar descuento"** visible solo si
`roleHasAccess(user?.role, 'billing')` y el cliente no está dado de baja. Abre el modal.

### Modal `ApplyDiscountModal.jsx` (nuevo, en `src/pages/Clients/`)
Props: `isOpen, onClose, client, invoices, onRefresh`.
- Calcula los **meses elegibles** desde `invoices`: `paymentStatus==='pending'` &&
  `invoiceStatus==='pending'`, ordenados.
- Selects **mes inicio** y **mes fin** (label "mmmm yyyy"), poblados con meses elegibles.
- Input **porcentaje** (number, 1–100).
- Validación en vivo:
  - fin ≥ inicio y al menos 2 meses distintos.
  - todos los meses entre inicio y fin (inclusive) son elegibles y consecutivos (sin
    huecos): si hay un mes cobrado/facturado o faltante en el medio → mensaje de error y
    botón deshabilitado.
- Preview: lista de meses afectados con monto de asistencia actual → con descuento
  (usar `attendanceChargeableGross` de cada invoice × factor; transporte aparte sin tocar).
- Confirmar → `applyPlanDiscount(...)` → `onRefresh()` → cerrar.

### Badge por mes (`MonthCard` en `ClientDetail.jsx`)
- Cuando `invoice.discountPercent > 0` y `canViewBilling`, mostrar un chip `−X%` en el
  header del mes (junto a los badges de pago/factura).
- Si el mes sigue `pending`/`pending`, ofrecer "Quitar" (re-usa patrón de dropdown de
  estado existente) → `removePlanDiscount` sobre ese único mes (rango de 1 mes permitido
  para remover; la validación de ≥2 meses aplica solo a aplicar, no a quitar).
- El detalle de montos del `MonthCard` ya lee de `calculateMonthBilling`, así que muestra
  el monto descontado automáticamente.

### Emisión (`EmitInvoiceModal.jsx`)
- Al pre-poblar el concepto de asistencia, si `billing.discountPercent > 0`, sufijo:
  `Plan {freq} días x semana – {sched} (X% dto)`.
- `attAmount` ya viene de `billing.attendanceChargeableGross` (descontado). Sin cambios
  adicionales en la lógica de emisión.

## Testing

- **Cálculo (RPC `calculate_month_billing`):** con descuento, `attendanceChargeable*` =
  base × factor; `transportChargeable*` intacto; `totalChargeableGross` coherente;
  `discountPercent` devuelto. Sin descuento (0), comportamiento idéntico al actual.
- **`apply_plan_discount`:** rechaza rango < 2 meses; rechaza si algún mes del rango está
  cobrado o facturado; rechaza percent fuera de 0–100; aplica a todas las filas del rango;
  `percent=0` limpia.
- **Modal:** validación de consecutividad y elegibilidad; preview correcto.

## Fuera de alcance (futuro)

- Aplicar promos en masa desde el dashboard / emisión masiva.
- Agrupación/auditoría explícita del rango como entidad "promoción".
- Descuentos sobre transporte.
