# Módulo de costos: taxonomía y estadística (corrección + contingencia + copiar variables)

## Contexto

El dashboard de Finanzas agrega los costos del mes de forma incompleta e inconsistente.
Este spec fija el modelo completo del módulo de costos y corrige tres huecos.

## Taxonomía de costos (5 tipos)

| Tipo | Tabla | Categoría propia | Temporalidad | Bucket |
|---|---|---|---|---|
| Fijos | `fixed_expenses` | Sí | periodicidad → caja (mes de pago) / mensualizado (÷ periodo) | su categoría |
| Variables | `expenses` | Sí | monto del mes (caja = mensual) | su categoría |
| Extraordinarios contingencia | `extraordinary_expenses` | Sí | monto del mes (caja) | su categoría |
| Sueldos empleados | `employees` + `employee_salary_adjustments` + `employee_extra_costs`(emp) | No | mensualizado (nominal + aguinaldo + vacacional + extraord. empleado amortizados 12m) | Sueldos |
| Extraordinarios sin empleado | `employee_extra_costs` (employee_id NULL) | No | **monto del mes (caja)** | Sueldos |

## Total de gastos del mes (unificado)

```
Gastos(mes) = variables(mes)                        [por categoría]
            + fijos(caja | mensualizado)             [por categoría]
            + extraordinarios contingencia(mes)      [por categoría]
            + sueldos empleados(mensualizado)        [Sueldos]
            + extraordinarios sin empleado(mes)      [Sueldos]
```

- **Caja vs mensualizado**: solo afecta a **fijos** (ya re-etiquetado: gráfico = caja, KPIs = mensualizado). El resto son montos del mes, iguales en ambas vistas. Sueldos empleados = run-rate mensual en ambas.
- Contingencia **sí** resta del margen (gasto real del P&L).

## Huecos que corrige (decisiones confirmadas)

### 1. Extraordinarios sin empleado — imputación por mes (revierte amortización ÷12)
- Estado: un fix previo los amortizaba ÷12 (`extraordinarios12m/12`) → $114.500 se veían como $9.542.
- Corrección: **suma del mes** (registros con fecha en ese mes), bajo Sueldos. Sin periodicidad
  (ya van anclados al mes). Se reemplaza `standaloneExtraCostForMonth` por una suma por mes.
- Costos (pantalla): la lista de "extraordinarios sin empleado" se **filtra al mes seleccionado**
  (hoy muestra todos), coherente con "van por mes". El alta default-ea la fecha al mes seleccionado.

### 2. Extraordinarios de contingencia — incluirlos en la estadística
- Estado: `extraordinary_expenses` **no llega al dashboard** (ni total ni desglose). El RPC
  `get_dashboard_finance_series` solo suma `expenses`.
- Corrección: se agregan al **total de gastos** (por mes, base caja) y al **desglose por categoría**
  (según su `categoryName`). Se traen client-side y se bucketean por mes (igual que fijos/sueldos),
  sin tocar el RPC.

### 3. Botón "sumar gastos variables del mes pasado" (feature nueva)
- En la sección de gastos variables (`CostsPage`), botón que abre un **modal de preview** con los
  variables del mes anterior (descripción, categoría, proveedor, monto). Montos **editables inline**;
  cada fila se puede excluir. Al confirmar, se crean como variables del **mes actual** (misma
  descripción/categoría/proveedor, monto editado, fecha = día 1 del mes actual).

## Plumbing

### Lógica pura (`financeSeries.js`)
- `standaloneExtraForMonth(costs, year, month)` = suma de standalone con `date` en (year, month).
  Reemplaza `standaloneExtraCostForMonth`.
- `contingencyForMonth(rows, year, month)` = suma de contingencia con `row.year==year && row.month==month`.
- Nuevo campo de fila `contingencyExpenses`.
- `selectExpensesOnly(row, {fixedBasis})` = `variableExpenses + fixed + contingencyExpenses`.
- `mergeFinanceSeries(rpcRows, employees, fixedExpenses, standaloneCosts, contingencyRows)`:
  - `salaries = salaryCostForMonth(employees) + standaloneExtraForMonth(standaloneCosts)`.
  - `contingencyExpenses = contingencyForMonth(contingencyRows)`.
- `expensesByCategory({ variableRows, fixedTemplates, extraordinaryRows, salaries }, year, month)`:
  suma variables + fijos(mensualizado activos) + **extraordinarios(contingencia) por categoría** +
  `add('Sueldos', salaries)` (salaries ya incluye standalone).

### Servicios
- `extraordinaryExpenseService`: `getAllExtraordinaryExpenses()` (todas las filas, para la serie).
- `dashboardService.getDashboardFinanceSeries`: además de employees/fixed/standalone, trae
  `getAllExtraordinaryExpenses()` y lo pasa a `mergeFinanceSeries`.

### FinanceSection
- Trae `getExtraordinaryByMonth(selected)` (mes) y lo pasa a `expensesByCategory` como `extraordinaryRows`.

### CostsPage
- Filtra `standaloneCosts` al mes seleccionado (client-side por `date`).
- Botón + `CopyLastMonthVariablesModal`: preview editable de los variables del mes anterior;
  confirma → `createExpense` por fila con año/mes actual.

## Testing / verificación
- TDD de las funciones puras nuevas/cambiadas (`standaloneExtraForMonth`, `contingencyForMonth`,
  `selectExpensesOnly` con contingencia, `expensesByCategory` con extraordinaryRows).
- Build limpio; suite verde.
- Verificación en BD: para el mes de prueba, el total de gastos incluye contingencia y standalone del mes.

## Fuera de alcance
- Extraordinarios de empleado (aguinaldo/despido/etc.): siguen amortizados 12m (correcto para eventos puntuales).
- No se toca el RPC del finance series (contingencia se suma client-side).
- La dualidad caja/mensualizado solo aplica a fijos (ya implementada).
