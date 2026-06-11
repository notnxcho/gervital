# Rework de Sueldos → Ficha de empleados

**Fecha:** 2026-06-11
**Estado:** Aprobado para implementación
**Alcance:** Reemplazar el módulo Sueldos plano (tabla `salaries`) por una ficha de empleados donde todos los costos laborales quedan asociados a cada empleado, con historia de sueldo fiel para análisis y derivación automática de aguinaldo / salario vacacional según normativa uruguaya.

---

## 1. Contexto y motivación

Hoy Sueldos es una tabla plana `salaries` con `kind` (`recurring` | `one_time`) y un `one_time_type` discreto (aguinaldo, despido, etc.), renderizada como un bloque dentro de `SupplierList.jsx`, solo para superadmin. No hay concepto de empleado, ni historia de sueldo, ni cálculo de costo laboral real.

Se quiere modelar **empleados** como fichas: cada uno con su sueldo (nominal + líquido), su historia de ajustes, sus gastos extraordinarios, y un costo anual mensualizado que refleje el costo real para la empresa (≠ nominal). Además, gastos extraordinarios sin empleado (consultorías) viven en la misma sección.

### Decisiones tomadas (brainstorming)
- **Salario vacacional:** base **líquido**, fórmula legal `(líquido / 30) × 20`, **20 días fijos** (no por antigüedad).
- **Aguinaldo:** `1/12 del nominal anual` = **1 mes de nominal** por año.
- **Ubicación UI:** se mantiene **embebido** en la página de Proveedores/Gastos (`SupplierList.jsx`), reemplazando el bloque Sueldos actual.
- **Ajuste semestral (default 3,5%):** **solo parámetro de proyección** a futuro. Los ajustes reales se cargan a mano como filas nuevas en la historia. No modifica datos históricos ni se auto-aplica.
- **Costo anual mensualizado:** incluye comp. regular **+ extraordinarios de los últimos 12 meses** del empleado.
- **Extraordinarios de empleado:** con **tipo discreto** (`despido`, `liquidacion`, `bono`, `otro`). Aguinaldo y salario vacacional ya NO se cargan acá (se calculan).
- **Datos existentes en `salaries`:** se **descartan** (DROP de la tabla). Datos actuales mínimos/de prueba.
- **Rol del empleado:** texto **libre** (no enum).
- **Acceso:** solo superadmin (igual que el módulo actual).

---

## 2. Modelo de datos (migración `026_employee_salaries.sql`)

Se eliminan la tabla `salaries` y sus policies. Se crean 3 tablas nuevas.

### `employees`
```sql
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  role TEXT,                                  -- texto libre: "Coordinadora", "Cocinera"
  semester_adjustment_pct NUMERIC(5,2) NOT NULL DEFAULT 3.5,  -- solo proyección
  active BOOLEAN NOT NULL DEFAULT TRUE,        -- baja sin borrar historia
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### `employee_salary_adjustments` — historia de sueldo
```sql
CREATE TABLE employee_salary_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  nominal NUMERIC(12,2) NOT NULL,
  liquido NUMERIC(12,2) NOT NULL,
  effective_date DATE NOT NULL,               -- desde cuándo rige este sueldo
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_salary_adj_employee ON employee_salary_adjustments(employee_id, effective_date DESC);
```
- **Sueldo vigente** = fila con `effective_date` máxima (desempate por `created_at`).
- El alta del empleado crea el **primer adjustment**, con `effective_date` = fecha de alta.
- Cada ajuste real = fila nueva → la evolución queda registrada y es fiel para análisis.

### `employee_extra_costs` — gastos extraordinarios (con o sin empleado)
```sql
CREATE TABLE employee_extra_costs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,  -- NULL = sin empleado (consultoría)
  type TEXT CHECK (type IN ('despido', 'liquidacion', 'bono', 'otro')),  -- NULL cuando no hay empleado
  concept TEXT,
  amount NUMERIC(12,2) NOT NULL,              -- monto nominal
  date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_extra_costs_employee ON employee_extra_costs(employee_id);
CREATE INDEX idx_extra_costs_date ON employee_extra_costs(date);
```
- `employee_id = NULL` → extraordinario sin empleado: solo `concept` + `amount` + `date` (type queda NULL).

### RLS (las 3 tablas, solo superadmin)
Mismo patrón que `salaries` actual: SELECT/INSERT/UPDATE/DELETE con `USING (is_superadmin())` / `WITH CHECK (is_superadmin())`.

### View `employees_full`
Estilo `clients_full`: devuelve cada empleado con sus adjustments y extras anidados como JSON, ordenados, para consumo del frontend. Los **derivados de costo se calculan en JS** (no en SQL) para mantener el SQL simple y la lógica testeable.
```sql
CREATE VIEW employees_full WITH (security_invoker = on) AS
SELECT
  e.*,
  COALESCE((SELECT jsonb_agg(a ORDER BY a.effective_date DESC, a.created_at DESC)
            FROM employee_salary_adjustments a WHERE a.employee_id = e.id), '[]') AS adjustments,
  COALESCE((SELECT jsonb_agg(x ORDER BY x.date DESC)
            FROM employee_extra_costs x WHERE x.employee_id = e.id), '[]') AS extra_costs
FROM employees e;
```

---

## 3. Cálculos — helper JS testeable

Módulo nuevo `src/services/salaries/salaryCalc.js` (lógica de negocio en un solo lugar, con tests):

```js
export const VACATION_DAYS = 20

// Sueldo vigente: adjustment con effective_date más reciente
export function currentSalary(adjustments) { ... }   // → { nominal, liquido, effectiveDate } | null

export function aguinaldoAnual(nominal) { return nominal }              // 1/12 del nominal anual
export function salarioVacacionalAnual(liquido) { return (liquido / 30) * VACATION_DAYS }

// Σ extraordinarios del empleado en los últimos 12 meses respecto a `asOf` (default hoy)
export function extraordinarios12m(extraCosts, asOf) { ... }

export function costoAnual({ nominal, liquido, extraCosts }, asOf) {
  return nominal * 12 + aguinaldoAnual(nominal) + salarioVacacionalAnual(liquido) + extraordinarios12m(extraCosts, asOf)
}
export function costoAnualMensualizado(args, asOf) { return costoAnual(args, asOf) / 12 }

// Proyección a futuro aplicando el % semestral (para uso posterior en análisis)
export function proyectarNominal(nominal, pct, semestres) { return nominal * Math.pow(1 + pct/100, semestres) }
```

`asOf` se inyecta (no `Date.now()` interno) para que los cálculos sean deterministas y testeables.

---

## 4. Servicio — reescritura de `salaryService.js`

Se reemplaza el contenido actual (kind/one_time) por API centrada en empleados. Mantiene named exports; `api.js` se actualiza para re-exportar lo nuevo y dejar de exportar lo viejo.

```
EXTRA_COST_TYPES                          // [{value,label}] despido/liquidacion/bono/otro

getEmployees()                            // employees_full → mapRow (camelCase, adjustments/extras anidados)
createEmployee({ name, role, semesterAdjustmentPct, nominal, liquido, effectiveDate })
                                          // inserta employee + primer adjustment (atómico vía RPC o 2 inserts)
updateEmployee(id, { name, role, semesterAdjustmentPct, active })
deleteEmployee(id)                        // cascade borra adjustments y extras

addSalaryAdjustment(employeeId, { nominal, liquido, effectiveDate, notes })
deleteSalaryAdjustment(id)                // (no se permite borrar el único/primero — validación en UI)

addExtraCost({ employeeId|null, type, concept, amount, date })
deleteExtraCost(id)
```
`mapRow` arma `{ id, name, role, semesterAdjustmentPct, active, adjustments[], extraCosts[] }` y deja los derivados al helper en el frontend.

**Atomicidad del alta:** `createEmployee` debe crear empleado + primer adjustment juntos. Opción A: RPC `create_employee_with_salary` (patrón del repo, p.ej. `save_transport_day`). Opción B: dos inserts secuenciales con rollback manual. **Recomendación: RPC** para consistencia con el patrón existente y atomicidad real.

---

## 5. UI — bloque Sueldos en `SupplierList.jsx`

Reemplaza el bloque actual (líneas ~334-434) y el `SalaryModal` (~688-790).

### Grid de empleados
- Card por empleado: nombre, rol, y **costo anual mensualizado** destacado (con nota "≠ nominal").
- Indicador de baja para inactivos. Botón "+ Empleado".

### `EmployeeFichaModal` (modal grande, al clickear una card)
- **Header**: costo anual mensualizado destacado + desglose (nominal vigente, aguinaldo, salario vacacional, extraord. 12m) + `semester_adjustment_pct` editable (default 3,5).
- **Sección Sueldo**: nominal/líquido vigentes; botón "Registrar ajuste" → form (nominal, líquido, fecha vigencia, notas) que inserta fila nueva. Tabla de historia de ajustes (evolución, desc por fecha).
- **Sección Extraordinarios**: lista (tipo, concepto, monto, fecha) + alta + borrar.
- Acciones de ficha: editar (nombre/rol/%), dar de baja (`active=false`), eliminar.

### Bloque "Extraordinarios sin empleado" (debajo del grid)
- Lista de `employee_extra_costs` con `employee_id NULL`: concepto + monto + fecha. Alta y borrado. Sin tipo.

### Alta de empleado (`AddEmployeeModal` o reuso de ficha en modo crear)
- Campos: nombre, rol, primer nominal, primer líquido, fecha de vigencia (default hoy), % ajuste semestral (default 3,5).

---

## 6. Archivos afectados

**Nuevos**
- `supabase/migrations/026_employee_salaries.sql`
- `src/services/salaries/salaryCalc.js` (+ tests)

**Modificados**
- `src/services/salaries/salaryService.js` — reescritura completa
- `src/services/api.js` — re-exports actualizados
- `src/pages/Suppliers/SupplierList.jsx` — bloque Sueldos: grid + modal ficha + bloque sin-empleado

**Eliminados (lógicos)**
- Tabla `salaries` y sus policies (en la migración)
- `SALARY_ONE_TIME_TYPES`, `createSalary`, `getSalaries`, etc. (reemplazados)

---

## 7. Fuera de alcance (futuro)

- Pantalla/dashboard de análisis y proyección a futuro con el % semestral (este rework solo deja el dato y el helper listos).
- Estado pagado/pendiente de extraordinarios (hoy solo fecha de incurrido).
- Días de licencia por antigüedad (se fija 20).
- Migración de datos viejos de `salaries` (se descartan).

---

## 8. Referencias normativa uruguaya

- Aguinaldo (SAC): 1/12 de las remuneraciones nominales del período → ~1 mes nominal/año. [datosUruguay](https://datosuruguay.com/aguinaldo)
- Salario vacacional: `(líquido / 30) × días de licencia`, base líquido; 20 días mínimo. [misalario.uy](https://misalario.uy/como-calcular-salario-vacacional-uruguay/)
