# Promociones prepagas — Diseño

**Fecha:** 2026-07-10
**Estado:** Aprobado (pendiente de plan de implementación)

## Contexto y problema

Hoy una "promoción" no existe como entidad. Es solo `monthly_invoices.discount_percent > 0`
aplicado mes a mes. El badge `X/Y` que se ve en la columna de cobranza se deriva con un
query *gaps-and-islands* (`get_month_collection_panel`, migración 052) que agrupa **todos los
meses contiguos con descuento**.

Consecuencia: dos promos de 3 meses aplicadas de forma consecutiva se fusionan en un único
run de 6 meses. Un cliente que arranca su segunda promo aparece como `4/6` en vez de `1/3`.
La raíz es la falta de identidad de la promo.

Además, el "pago por adelantado" no existe como feature real. Lo único parecido es un checkbox
en `ApplyDiscountModal` que hace `markMonthPaid` en loop con una misma fecha. La migración 052
ya atribuye el cash prepago al mes del `paid_date` (colapsa todo en el mes de pago), pero no hay
forma de visualizar, en los meses siguientes del run, cuánto aportaría el cliente si no hubiera
prepagado.

## Objetivos

1. Convertir la promo prepaga en una **entidad identificable** con run propio, de modo que
   promos concatenadas no se fusionen y se pueda identificar la run activa.
2. Reflejar el **impacto cash real** del pago adelantado: el mes del pago concentra todo el
   ingreso; los meses siguientes del run muestran `$0` de cash pero recuerdan el monto
   mensualizado que aportaría el cliente (tachado, baja opacidad).
3. Ofrecer una **sección de gestión de promociones** en el dashboard (solo superadmin).

## Decisiones tomadas

- **Se mantienen dos conceptos distintos:** el *descuento suelto* actual (per-mes, sin prepago,
  sin cambios) y la nueva *promo prepaga* (entidad con run + pago adelantado).
- **Run, badge X/Y y visualización tachada + $0 son exclusivos de la promo prepaga.**
- **Pago al crear:** el acto de crear la promo ES el prepago (todo en un paso atómico).
- **Gestión:** sección dedicada dentro del Dashboard (junto a Finanzas/Asistencia/Comercial),
  **solo superadmin**. Crear promos prepagas también es solo superadmin.
- **Cancelación/reembolso: fuera de alcance v1.** Correcciones manuales si hace falta.
- **Promo siempre lleva descuento** (percent 1–100). Promo con 0% fuera de alcance.
- **Datos existentes no se migran:** los `discount_percent > 0` actuales sin `promo_id` quedan
  como descuento suelto. Solo las promos nuevas nacen como entidad.

## Modelo de datos

### Nueva tabla `promotions`
```
id              uuid pk
client_id       uuid fk -> clients
discount_percent numeric(5,2)  -- 1..100
start_year      int
start_month     int            -- 0-indexed (consistente con monthly_invoices)
end_year        int
end_month       int
paid_date       date
paid_amount     numeric        -- total prepagado = suma de meses (plan*(1-dto) + transporte)
payment_method  text
notes           text
created_at      timestamptz default now()
created_by      uuid fk -> auth.users
```

### Membership: columna `promo_id` en `monthly_invoices`
- Columna FK nullable `promo_id uuid references promotions(id)`.
- Cada mes del run queda etiquetado con su promo. Elegido sobre "derivar por rango" porque
  resuelve la concatenación de raíz (dos promos consecutivas nunca se fusionan) y hace trivial
  el cálculo del badge (`mes − start + 1` / `end − start + 1`) sin gaps-and-islands.
- Meses de descuento suelto quedan con `promo_id = NULL`.

## RPC de creación

`create_prepaid_promo(p_client, p_start_year, p_start_month, p_end_year, p_end_month, p_percent, p_paid_date, p_payment_method, p_notes)`
— `SECURITY DEFINER`, con chequeo de rol **superadmin**. Atómico:

1. **Valida** el rango: consecutivo, ≥2 meses, y que **todos** los meses estén
   `payment_status='pending'` AND `invoice_status='pending'` (misma regla que el descuento
   actual — no se puede prepagar algo ya cobrado/facturado). Valida `p_percent` 1–100.
2. Inserta la fila en `promotions` (con `created_by`, `paid_date`, `payment_method`, `notes`).
3. Para **cada mes** del rango:
   - setea `discount_percent`,
   - calcula el monto del mes (`plan × (1 − dto) + transporte`) vía `calculate_month_billing`,
   - lo marca **pagado** con el `paid_date` compartido y snapshot `paid_amount` de ese mes,
   - lo etiqueta con `promo_id`.
4. Acumula el `paid_amount` total en la fila de `promotions` y la devuelve.

El transporte se prepaga junto con la asistencia (coherente con marcar el mes completo pagado).

## Cambios en cobranza (`get_month_collection_panel` + `CollectionPanel.jsx`)

### Badge X/Y
- El cálculo pasa de gaps-and-islands a leer la promo del mes vía `promo_id`:
  `X = mes_actual − promo.start + 1`, `Y = promo.end − promo.start + 1`.
- **Solo aparece para meses con `promo_id`.** Los meses con descuento suelto ya no muestran X/Y.
- Resultado: la segunda promo consecutiva arranca en `1/3`, no `4/6`.

### Visualización cash del prepago
- **Mes del pago** (donde cayó `paid_date`): muestra el **total prepagado** como cash cobrado
  (ya funciona vía migración 052, `cash_collected` agrupado por `paid_date`).
- **Meses siguientes del run** (prepagos, cash atribuido a otro mes → `cash_collected = 0` pero
  `paid_amount > 0` y `promo_id` presente): muestran `~~$monto_mensual~~` (tachado, baja
  opacidad) **+ `$0`** al lado.
  - Monto tachado = snapshot `paid_amount` de ese mes (lo que aportaría si no fuera prepago).
- **El total de la cabecera cuenta el cash real (`cash_collected`)**: los meses tachados suman
  `$0` al total. El tachado es puramente visual; el ingreso cash del mes queda fiel.

## Sección Promociones del Dashboard (solo superadmin)

Nueva pestaña **"Promociones"** junto a Finanzas/Asistencia/Comercial, gated por superadmin.

1. **KPIs (arriba):**
   - # promos activas
   - total prepagado en caja **del período seleccionado** del dashboard
   - descuento total otorgado ($)
   - # próximas a vencer
2. **Promos activas** (el mes de referencia del período cae dentro de `[start, end]`): cliente,
   % dto, rango de meses, **X/Y** (mes del run), monto prepagado, fecha de pago.
3. **Próximas a vencer:** promos cuyo `end` es el mes de referencia o el siguiente (renovación/
   concatenación).
4. **Historial:** promos cuyo run ya terminó, con filtro por cliente/período.

**Datos:** nueva RPC `get_promotions_overview(p_year, p_month)` que lee `promotions` (+ join a
`clients_full` para nombres), clasifica cada promo en activa / próxima a vencer / histórica según
el mes de referencia, y devuelve los agregados para KPIs (el "total prepagado en caja" se filtra
al período seleccionado por `paid_date`). Servicio `promotionService.js`.

Archivos nuevos aproximados: `sections/PromotionsSection.jsx` + subcomponentes (KPIs reutilizan
el patrón de `KpiRow`, listas al estilo `CollectionPanel`).

## Cambios en detalle del cliente

- Nueva entrada **"Promo prepaga"** en el menú ⋯ (solo superadmin), abre un modal separado
  `PrepaidPromoModal`. Reutiliza el timeline y presets de `%` de `ApplyDiscountModal`, pero suma
  campos de pago (fecha, método) y calcula/muestra el total prepago. El descuento suelto actual
  queda intacto en su propio modal.
- Badge de **promo activa** cuando el cliente tiene una promo en curso (además del
  `hasActiveDiscount` existente).

## Componentes y límites

| Unidad | Qué hace | Depende de |
|--------|----------|------------|
| tabla `promotions` | Identidad de la promo prepaga | — |
| `monthly_invoices.promo_id` | Membership mes → promo | `promotions` |
| `create_prepaid_promo` RPC | Crea promo + prepaga meses atómicamente (superadmin) | `promotions`, `calculate_month_billing`, `mark_month_paid` |
| `get_month_collection_panel` (mod) | Badge X/Y por `promo_id` + flags para tachado | `promotions`, `monthly_invoices` |
| `get_promotions_overview` RPC | Datos de la sección del dashboard | `promotions`, `clients_full` |
| `promotionService.js` | Capa JS (crear promo, overview) | RPCs |
| `PrepaidPromoModal.jsx` | UI de creación (superadmin) | `promotionService`, `calculateMonthBilling` |
| `PromotionsSection.jsx` | Sección dashboard | `promotionService`, `KpiRow` |
| `CollectionPanel.jsx` (mod) | Badge X/Y + tachado $0 | datos de `get_month_collection_panel` |

## Permisos

- Ver sección Promociones del dashboard: **superadmin**.
- Crear promo prepaga: **superadmin** (reforzado en el RPC `SECURITY DEFINER`).
- Descuento suelto: sin cambios (feature `billing`, admin+superadmin).

## Fuera de alcance (v1)

- Cancelación / reembolso de promos.
- Promos con 0% de descuento.
- Migración de descuentos existentes a la tabla `promotions`.
- Renovación automática / concatenación asistida (la sección "próximas a vencer" solo informa).
