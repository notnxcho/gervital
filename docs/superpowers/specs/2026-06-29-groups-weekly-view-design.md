# Vista semanal de grupos (modal de solo lectura)

**Fecha:** 2026-06-29
**Estado:** Aprobado

## Objetivo

Agregar a la página de Grupos (`/grupos`) una vista semanal de solo lectura que
permita ver de un vistazo quién asiste cada día de la semana, su tier cognitivo y
si viene con transporte. Misma UX que la vista semanal de Transporte
(`TransportWeekTable`): un botón abre un modal; no se realizan acciones dentro.

## Alcance

- Solo lectura. Sin drag & drop, sin edición, sin guardado.
- Reutiliza el patrón de modal, búsqueda y cierre de `TransportWeekTable.jsx`.
- No modifica la lógica existente del editor diario (`DailyGroups`).

## Componentes

### `src/pages/Groups/GroupsWeekTable.jsx` (nuevo)

Props: `{ isOpen, onClose, clients }`.

Modal con:
- Overlay + backdrop (click cierra), cierre con tecla `Escape`, botón X.
- `document.body.style.overflow = 'hidden'` mientras está abierto.
- Buscador por nombre que filtra toda la grilla (normaliza acentos/mayúsculas,
  igual que Transporte).

Tabla:
- **Columnas:** Lunes → Viernes (`WEEK_DAYS`).
- **Filas:** 2 turnos — `Mañana` y `Tarde`.
- **Encabezado de cada día:** nombre del día + "N asistentes" (únicos del día) +
  "🚚 M con transporte" (cantidad de asistentes únicos del día con
  `plan.hasTransport`).
- **Celda (día × turno):** lista de clientes que asisten ese día en ese turno.

### `src/pages/Groups/GroupsWeekTable.css` (nuevo)

Estilos adaptados de `TransportWeekTable.css` (misma estética de overlay, panel,
tabla, chips). Clases con prefijo propio (`gwk-`) para no acoplarse a Transporte.

### `src/pages/Groups/DailyGroups.jsx` (modificado)

- Estado nuevo: `const [showWeek, setShowWeek] = useState(false)`.
- En el header (junto a "Plantillas"), `Button variant="secondary"` con ícono
  `Calendar`: **"Vista semanal"**. Visible siempre (no depende de `readOnly`).
- Render del modal `<GroupsWeekTable isOpen={showWeek} onClose={...} clients={allClients} />`.

## Lógica de filtrado (por día y turno)

Misma regla que `shiftClients` en `DailyGroups`:

```js
function clientsForDayShift(clients, dayKey, shift) {
  return clients.filter(c =>
    c.plan?.assignedDays?.includes(dayKey) &&
    (shift === 'morning'
      ? (c.plan?.schedule === 'morning' || c.plan?.schedule === 'full_day')
      : (c.plan?.schedule === 'afternoon' || c.plan?.schedule === 'full_day'))
  )
}
```

- Los clientes `full_day` aparecen en **ambas** filas (Mañana y Tarde).
- Asistentes únicos del día = unión de ids de ambos turnos (cuenta una vez).
- Con transporte del día = asistentes únicos con `plan.hasTransport === true`.

## Chip de cliente (read-only)

- Punto de color por tier: `TIER_HEX = { A:'#34d399', B:'#38bdf8', C:'#fbbf24', D:'#fb7185' }`.
- Nombre y apellido.
- Ícono `Truck` (iconoir-react) si `plan.hasTransport === true`.
- Orden dentro de la celda: por tier (A→B→C→D), luego apellido/nombre.

## Constantes

```js
const WEEK_DAYS = [
  { key: 'monday', label: 'Lunes' },
  { key: 'tuesday', label: 'Martes' },
  { key: 'wednesday', label: 'Miércoles' },
  { key: 'thursday', label: 'Jueves' },
  { key: 'friday', label: 'Viernes' }
]
const SHIFT_ROWS = [
  { key: 'morning', label: 'Mañana' },
  { key: 'afternoon', label: 'Tarde' }
]
```

## Fuera de alcance

- Edición de `assignedDays` o del plan desde la vista.
- Navegación entre semanas (los días dependen del plan, no de fechas concretas;
  la vista es estructural, no calendárica).
- Mostrar actividades/time slots por día.

## Verificación

- Compilar Tailwind si se usan clases utilitarias nuevas en el JSX:
  `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.
- Abrir `/grupos`, click "Vista semanal": modal muestra 5 columnas × 2 filas.
- Un cliente `full_day` aparece en Mañana y Tarde del/los día(s) de su plan.
- Cliente con `hasTransport` muestra ícono de camión y suma al contador del día.
- Búsqueda filtra la grilla; Escape y backdrop cierran el modal.
