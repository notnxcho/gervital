# Fondo de contingencia + Gastos extraordinarios

## Contexto

En la pantalla de Costos (`src/pages/Costs/CostsPage.jsx`) hay cuatro KPI cards de
resumen del mes: Total del mes (caja), Gastos fijos (impacto), Gastos variables y
**Fijos mensualizado (ref.)** (`fixedMonthlyForMonth`, el 4º/último card).

Se agrega un **fondo de contingencia**: una barra de progreso debajo de las cuatro
cards cuyo límite es un porcentaje customizable (default **10%**) del último KPI card
(fijos mensualizado). La barra se llena con un nuevo tipo de gasto, los **gastos
extraordinarios**, que —como el resto de gastos— tienen proveedor y categoría.

### Decisiones (confirmadas con el usuario)

1. **Base del límite**: `10% × fixedMonthlyForMonth` (el 4º card, "Fijos mensualizado").
2. **Los extraordinarios sí suman** al card "Total del mes (caja)" (son caja real del mes).
3. **El % lo editan solo admin y superadmin**. Ver/cargar/editar/borrar extraordinarios
   es **acceso completo a todos los roles** (operador, admin, superadmin).

### Notas de contexto

- Ya existe un concepto de "gastos extraordinarios" en la sección **Sueldos**
  (`salary_extra_costs`, solo superadmin, ligados a empleados). El fondo de contingencia
  es un concepto **nuevo y distinto**: acceso completo, con proveedor + categoría, y su
  propia tabla. No se reutiliza ni se mezcla con los de Sueldos.
- El modelo de gastos actual: `expenses` (variables, month-scoped, con `supplier_id` +
  `category_id`), `fixed_expenses` (plantillas con periodicidad), `expense_categories`,
  `suppliers`. RLS de gastos = cualquier autenticado.
- No existe tabla de settings/config: el % customizable necesita dónde vivir.

## Modelo de datos (migración 040)

### Tabla `extraordinary_expenses`

Espeja `expenses` (mismo patrón, month-scoped):

```sql
CREATE TABLE extraordinary_expenses (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL,
  year        INT NOT NULL,
  month       INT NOT NULL CHECK (month BETWEEN 0 AND 11),
  date        DATE NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

- View `extraordinary_expenses_view` con `categoryName` (mismo shape que `expenses_view`:
  campos camelCase `supplierId`, `categoryId`, `categoryName`, etc.).
- Índice por `(year, month)`.
- Trigger `updated_at` (reutilizar el patrón de `fixed_expenses`, migración 037).
- RLS: **acceso completo a todo autenticado** (SELECT/INSERT/UPDATE/DELETE con
  `is_authenticated()`), igual que `expenses`.

**Se modela aparte y no como flag en `expenses`** para que los extraordinarios no ensucien
el listado ni el total de variables, y tengan su propio bucket contra el fondo.

### Tabla `app_settings` (key/value genérica)

```sql
CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO app_settings (key, value) VALUES ('contingency_fund_pct', '10');
```

- RLS: **SELECT** para todo autenticado; **INSERT/UPDATE** solo `is_admin_or_superadmin()`
  (helper ya existe, migración 020).
- Genérica y reutilizable para futuros settings globales (ej. precios de transporte).

## Servicios

- `src/services/expenses/extraordinaryExpenseService.js`: `getExtraordinaryByMonth(year, month)`,
  `createExtraordinary`, `updateExtraordinary`, `deleteExtraordinary`. Calcado de
  `expenseService.js` (mismo `transformExpense`, mismos campos).
- `src/services/settings/appSettingsService.js`: `getSetting(key)`, `setSetting(key, value)`.
- Lógica pura `src/services/expenses/contingencyFund.js` (+ tests):
  - `contingencyLimit(fixedMonthly, pct)` → `fixedMonthly * pct / 100`.
  - `contingencyStatus(consumed, limit)` → `{ fillPct, remaining, over }` donde
    `fillPct = limit > 0 ? min(100, consumed/limit*100) : (consumed > 0 ? 100 : 0)`,
    `remaining = limit - consumed` (puede ser negativo), `over = consumed > limit`.
  - Maneja `limit === 0` sin división por cero.
- Re-export de todo en `src/services/api.js`.

## UI

### Barra de progreso (debajo de las 4 KPI cards)

`Card` full-width con:

- Título **"Fondo de contingencia"** + subtítulo con monto límite
  (`formatCurrency(limit)`, "10% de fijos mensualizado") y "consumido / límite".
- **Barra de progreso**: fill = `contingencyStatus().fillPct`. Color:
  - Verde/azul (`bg-emerald-500`) por debajo del ~80%.
  - Ámbar (`bg-amber-500`) entre 80% y 100%.
  - Rojo (`bg-red-500`) si supera el límite (`over`); barra capeada visualmente al 100% y
    se muestra el excedente (ej. "Excedido por $X").
- **Editar %**: ícono lápiz inline, **solo visible admin+**. Al hacer clic, mini-input
  (popover o inline) para cambiar el %; guarda vía `setSetting('contingency_fund_pct', ...)`
  y refresca. RLS refuerza server-side.
- **Chevron** (colapsable, patrón de `CategoryGroup`) → despliega el detalle:
  - Botón **"+ Gasto extraordinario"** → modal calcado de `VariableExpenseModal`
    (descripción, categoría, proveedor, monto, fecha, notas).
  - Lista de gastos extraordinarios del mes **agrupados por categoría** (reusa
    `groupByCategory` + `CategoryGroup` + tarjetas con proveedor/categoría/monto/fecha,
    igual que las variables). Editar/eliminar por tarjeta.
- Edge case `fixedMonthlyForMonth === 0` → límite 0, sin división por cero; barra muestra
  0 de límite y cualquier gasto queda "excedido".

### Card "Total del mes (caja)"

Pasa a `variableTotal + fixedCashThisMonth + extraordinaryTotal`.

### Carga de datos

`loadData()` en `CostsPage` agrega en paralelo: `getExtraordinaryByMonth(year, month)` y
`getSetting('contingency_fund_pct')`. Estado nuevo: `extraordinaryExpenses`, `contingencyPct`.

## Acceso

- Ver/cargar/editar/borrar gastos extraordinarios: **todos los roles**.
- Editar el % del fondo: **solo admin y superadmin** (frontend oculta el control con el
  predicado admin+; RLS bloquea el UPDATE/INSERT en `app_settings`).

## Testing / verificación

- Tests unitarios de `contingencyFund.js` (límite, fill %, over, edge case límite 0).
- Verificación manual del flujo: cargar un extraordinario, ver la barra llenarse, superar
  el límite (rojo + excedente), editar el % como admin, confirmar que operador no ve el
  control de edición, confirmar que el Total del mes (caja) incluye el extraordinario.

## Fuera de alcance

- No se toca la sección de Sueldos ni sus extraordinarios (`salary_extra_costs`).
- No se agrega el fondo de contingencia al Dashboard financiero (solo pantalla de Costos).
