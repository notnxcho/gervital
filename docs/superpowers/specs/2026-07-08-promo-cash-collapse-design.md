# Colapso de caja de promociones en Cobranza — Diseño

**Fecha:** 2026-07-08
**Estado:** Aprobado (enfoque A)

## Objetivo

En el dashboard de Finanzas, la **Cobranza (cash)** debe reflejar el dinero cuando
efectivamente ingresa: atribuido al **mes de la fecha de pago (`paid_date`)**, no al
mes propio de cada factura. Como las promociones (descuento sobre un rango
consecutivo de meses) se suelen **prepagar** con una única fecha, todo el cash del
rango cae en ese mes. Además, cada mes del rango de promo muestra un **badge**
(ícono + `X/Y`) para que el administrador vea, en su flujo mensual, qué clientes
tienen promo y su avance.

La **Facturación** NO cambia: sigue emitiéndose mensual (un comprobante por mes).

## Ejemplo canónico

Cliente con promo 10% en jul/ago/sep, `paid_date` = 1-jul, plan 30.000 → 27.000/mes:
- **Cobranza:** julio = 81.000 (3×27.000), agosto = 0, septiembre = 0.
- **Badge:** julio `1/3` (fila colapsada de 81.000), agosto `2/3` ($0), septiembre `3/3` ($0).
- El cliente **aparece en los 3 meses** del panel de cobranza (los tres invoices
  quedan `payment_status='paid'`).
- **Facturación:** 27.000 en jul, ago y sep (sin colapsar).

## Alcance de la regla de caja

**General:** TODO cobro se atribuye al mes de su `paid_date`, tenga o no descuento.
Para un cliente sin promo que paga su mes en fecha, `paid_date` cae en el mes de la
factura → sin cambio visible. El badge `X/Y` es decoración solo para clientes en un
rango de promo.

## Enfoque elegido: A (todo en SQL)

Modificar las dos funciones RPC del dashboard; el frontend solo renderiza campos
nuevos + badge. Una sola fuente de verdad → agregado (serie/chart/KPIs) y panel
por cliente quedan consistentes. Sin cambio de esquema.

## Modelo

### Atribución de caja
El cobrado se atribuye al mes de `COALESCE(paid_date, make_date(mi.year, mi.month+1, 1))`
— fallback al mes propio de la factura cuando `paid_date` es NULL (pagos viejos sin
fecha), preservando el histórico.

### Rango de promo (X/Y) — gaps-and-islands
Por cliente, una "promo" es una corrida **contigua** de meses (por `year*12+month`)
con `discount_percent > 0` en `monthly_invoices`. Para el mes mostrado que pertenece
a una corrida:
- `promo_total` (Y) = largo de la corrida.
- `promo_index` (X) = posición 1-based del mes dentro de la corrida.
- `promo_percent` = `discount_percent` del mes.
Meses sin descuento → sin badge (X/Y nulos). Corridas separadas por un mes sin
descuento son promos distintas. Sin cambio de esquema.

## Backend

### `get_dashboard_finance_series` (serie agregada)
CTE `paid`: reagrupar los `attendance_chargeable_*` y `transport_chargeable_*` de
las facturas pagadas por el `(año, mes)` de `COALESCE(paid_date, mes de factura)` en
vez de `(mi.year, mi.month)`. El resto de la función (previsto live, expenses,
bounds, months) queda igual. Resultado: "Cobrado" da 81.000 en julio, 0 ago/sep.

### `get_month_collection_panel` (panel por cliente del mes)
Agregar tres columnas al retorno:
- `cash_collected numeric` = Σ `paid_amount` de las facturas del cliente cuyo
  `COALESCE(paid_date, mes de factura)` cae en el `(p_year, p_month)` seleccionado.
  (81.000 en la fila de julio; 0 en ago/sep.)
- `promo_index int`, `promo_total int` = X/Y del rango de promo que contiene el mes
  seleccionado (NULL si el mes no tiene descuento).
- `promo_percent numeric` = descuento del mes (para tooltip).
Mantener todas las columnas actuales (payment_status, paid_amount, paid_date, etc.).

Ambas funciones siguen `SECURITY INVOKER` (RLS de base aplica; `monthly_invoices`
restringido a admin/superadmin). `calculate_month_billing` sigue `SECURITY DEFINER`.

## Frontend

### `dashboardService.getMonthInvoicePanel`
Mapear los campos nuevos: `cashCollected`, `promoIndex`, `promoTotal`, `promoPercent`.

### `CollectionPanel` (dominio Cobranza)
- **Badge de promo**: cuando `promoTotal` no es null, mostrar un chip (ícono +
  `${promoIndex}/${promoTotal}`), tooltip con el % y "prepago" del rango. Aparece en
  la fila del cliente dentro del dominio Cobranza.
- **Tab "Cobrados"**: el monto de la fila y el total del mes usan `cashCollected`
  (fila colapsada de 81.000 en julio; filas de $0 con badge en ago/sep). El cliente
  aparece en los tres meses porque sus tres invoices quedan `payment_status='paid'`.
- No tocar el dominio Facturación ("Emitidas" sigue por mes).

### KPIs / `MonthlyFinanceChart`
Sin cambios: el "Cobrado" ya deriva de la serie → refleja el colapso automáticamente.

## Facturación intacta
El dominio Facturación / "Emitidas" y `invoiced_amount` siguen por mes. Solo cambia
la atribución de Cobranza.

## Bordes
- Prepago parcial (distintas fechas): cada cobro cae en el mes de su `paid_date`.
- `paid_date` NULL: fallback al mes de la factura.
- Descuentos no contiguos: corridas separadas → promos distintas.
- Mes de promo aún no pagado: `cash_collected` = 0 en ese mes, badge X/Y igual visible
  (el cliente sale en el dominio Cobranza con su estado de pago).

## Fuera de alcance
- Guardar la promo como entidad con rango (enfoque C).
- Cambios en emisión de facturas / Biller.
- Badge en otras vistas fuera del dashboard de finanzas.

## Verificación
- SQL: round-trip de un cliente con promo 3 meses prepagados misma fecha → serie da
  Σ en el mes de pago y 0 en el resto; panel da `cash_collected` colapsado y X/Y
  correctos por mes. Cliente sin promo/pago normal → sin cambios.
- Tests puros para el cálculo de X/Y si se extrae lógica al frontend (no en enfoque A;
  X/Y va en SQL). Verificación de la serie vía consultas.
- UI: recorrer jul/ago/sep en el panel y ver 81k/0/0 con badges 1/3, 2/3, 3/3.
