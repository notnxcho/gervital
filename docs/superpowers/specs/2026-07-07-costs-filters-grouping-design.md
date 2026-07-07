# Filtros y agrupación por categoría en Costos

**Fecha:** 2026-07-07
**Estado:** Aprobado (diseño)

## Objetivo

Agregar agrupación por categoría (con subtotales) y filtros a las tres secciones
de listado de `src/pages/Costs/CostsPage.jsx`:

- **Gastos fijos** (plantillas recurrentes)
- **Gastos variables** (gastos del mes)
- **Proveedores** (directorio)

Hoy las tres son listas/grillas planas sin forma de acotar ni resumir por
categoría. El objetivo es que el usuario pueda ver los costos organizados por
categoría con subtotal y acotar rápido con filtros.

## Contexto de datos (ya existe, sin cambios de modelo)

- **Gastos fijos y variables:** usan el sistema CRUD de categorías de gasto.
  Cada gasto tiene `categoryId` y `categoryName` (puede ser `null` → "Sin categoría").
  Además tienen `supplierId`/`supplierName`, `amount`, `description`, `notes`.
- **Proveedores:** usan su propio campo `category` (string, de `SUPPLIER_CATEGORIES`
  hardcodeado). Tienen `name`, `contact`, `phone`, `email`, `notes`. **No tienen monto.**

No se toca el backend ni el modelo de datos.

## Comportamiento por sección

| Sección | Agrupa por | Filtros | Subtotal por grupo |
|---|---|---|---|
| Gastos fijos | categoría de gasto (`categoryName`) | categoría, proveedor, texto, rango de monto | sí (suma de `amount` por pago) |
| Gastos variables | categoría de gasto (`categoryName`) | categoría, proveedor, texto, rango de monto | sí (suma de `amount`) |
| Proveedores | categoría del proveedor (`category`) | categoría, texto | no (no hay montos) |

### Reglas de agrupación

- Grupos ordenados alfabéticamente por nombre de categoría.
- Bucket final **"Sin categoría"** para items con categoría `null`/vacía, siempre al final.
- Cada grupo es un encabezado **colapsable** que muestra: nombre de categoría, cantidad
  de items y (cuando aplica) subtotal.
- **Los grupos arrancan expandidos** por defecto.
- Si un filtro deja un grupo sin items, ese grupo no se renderiza.
- Si no hay ningún item tras filtrar, se muestra el empty state existente de la sección.

### Reglas de filtrado

- **Texto:** match case-insensitive contra los campos de texto relevantes
  (gastos: `description` + `notes` + `supplierName`; proveedores: `name` + `contact` +
  `notes`).
- **Categoría:** dropdown; al elegir una categoría se muestra solo ese grupo. Convive
  con la agrupación sin conflicto.
- **Proveedor:** dropdown (solo gastos fijos/variables). "Sin proveedor" incluido como opción.
- **Rango de monto:** min y/o max opcionales (solo gastos fijos/variables). Cualquiera
  de los dos puede quedar vacío.
- Todos los filtros se combinan con AND.
- Sin persistencia: el estado de filtros y de colapso vive en memoria y se resetea al
  recargar la página o cambiar de mes.

## Arquitectura

Para no seguir inflando `CostsPage.jsx` (ya en ~1350 líneas), se extraen piezas nuevas:

### 1. Lógica pura + tests — `src/services/costs/costsFilters.js`

```js
// filterItems(items, filters, accessors) -> filtered array
//   filters:   { query, categoryId, supplierId, minAmount, maxAmount }
//   accessors: { getText(item) -> string, getCategoryId(item), getSupplierId(item), getAmount(item) }
//   - Campos de filtro vacíos/undefined se ignoran (no acotan).
//   - accessors ausentes (p.ej. getAmount en proveedores) se saltean.
export function filterItems(items, filters, accessors) { ... }

// groupByCategory(items, getKey, getLabel) -> [{ key, label, items, subtotal }]
//   - getKey(item) -> categoría (string/id) o null
//   - getLabel(key, item) -> nombre para mostrar
//   - subtotal = suma de getAmount cuando se provee; si no, 0/omitido
//   - ordenado alfabético por label; "Sin categoría" (key null) siempre al final
export function groupByCategory(items, { getKey, getLabel, getAmount }) { ... }
```

Tests en `src/services/costs/costsFilters.test.js` cubriendo:
- filterItems: cada filtro por separado, combinación AND, filtros vacíos = passthrough,
  case-insensitivity del texto, rango de monto con bordes.
- groupByCategory: orden alfabético, bucket "Sin categoría" al final, subtotales,
  ausencia de getAmount.

### 2. Componente presentacional — `src/pages/Costs/CostsFilterBar.jsx`

Fila compacta reutilizable. Props:
- `filters`, `onChange(nextFilters)`
- `categories` (lista para el dropdown de categoría)
- `suppliers` (opcional; si se pasa, muestra dropdown de proveedor)
- `showAmountRange` (bool; muestra inputs min/max)
- `searchPlaceholder`

Controles: buscador de texto + dropdown categoría + (opcional) dropdown proveedor +
(opcional) min/max monto. Sigue el estilo Tailwind existente de la página
(inputs `border-gray-300`, focus `ring-purple-500`).

### 3. Componente presentacional — `src/pages/Costs/CategoryGroup.jsx`

Encabezado colapsable + contenedor. Props:
- `label`, `count`, `subtotal` (opcional), `defaultOpen` (default `true`)
- `children` (los cards existentes ya renderizados)

Estado de abierto/cerrado local. Muestra chevron, nombre, contador y subtotal formateado
con `formatCurrency`.

### 4. Integración en `CostsPage.jsx`

- Cada sección obtiene su propio estado de filtros (`useState`) y su `CostsFilterBar`.
- Se aplica `filterItems` → `groupByCategory` → render de `CategoryGroup` que envuelve
  los cards existentes (`FixedExpenseCard`, `VariableExpenseCard`, y el card inline de
  proveedor).
- Proveedores: `CostsFilterBar` sin dropdown de proveedor ni rango de monto; grupos sin
  subtotal.
- Las tarjetas de resumen del tope (totales del mes) **no cambian**: siguen reflejando
  el total real del mes, no el filtrado.

## Fuera de alcance (YAGNI)

- Persistencia de filtros entre sesiones o meses.
- Filtros/agrupación en la sección de Sueldos/Empleados.
- Cambios en el modelo de datos o en los servicios de backend.
- Ordenamientos configurables (solo alfabético por categoría).

## Criterios de aceptación

1. Cada una de las 3 secciones muestra sus items agrupados por categoría, ordenados
   alfabéticamente, con "Sin categoría" al final.
2. Gastos fijos y variables muestran subtotal por grupo; proveedores no.
3. Los grupos son colapsables y arrancan expandidos.
4. Cada sección tiene su barra de filtros según la tabla de comportamiento.
5. Los filtros combinan con AND y los vacíos no acotan.
6. Empty states se respetan cuando el filtrado no deja items.
7. `costsFilters.js` tiene tests que pasan.
8. Sin cambios de backend.
