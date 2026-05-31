# Diseño: Rediseño de cards de cliente + flags de condiciones médicas

**Fecha:** 2026-05-31
**Estado:** Aprobado para implementación

## Objetivo

Rediseñar la card de cliente en la lista (`ClientList`) para mostrar información más
relevante y compacta, y agregar tres condiciones médicas booleanas al perfil del
cliente (diabético, celíaco, hipertenso) que se editan en el alta/edición y se
visualizan en la card y el detalle.

## Cambios en la card de cliente

Estado final de la card (cliente activo):

```
┌─────────────────────┐
│      [ foto ]       │
│ [B]         ↺ 2     │   ← tier (solo letra) overlay izq · recupero overlay der
├─────────────────────┤
│ Nombre Apellido     │
│ 72 años             │
│                     │
│ ●D  ●C  ●H          │   ← fila médica (solo activas, se oculta si ninguna)
│                     │
│ [L][M][M][J][V]  AM │   ← días (chips, 1 letra) · turno (texto)
└─────────────────────┘
```

Cambios concretos respecto al estado actual:

1. **Quitar fila "Contacto" + teléfono** (líneas ~290-293 de `ClientList.jsx`).
2. **Tier**: sigue como overlay sobre la foto, pero sin la palabra "Tier" — solo la
   letra (`B`). Cambiar `Tier {client.cognitiveLevel}` → `{client.cognitiveLevel}`.
3. **Días de la semana**: mantener los chips con fondo (violeta = asignado, gris = no),
   pero las etiquetas pasan a una sola letra: `L, M, M, J, V`. Actualizar `WEEK_DAYS`:
   - `monday: 'L'`, `tuesday: 'M'`, `wednesday: 'M'`, `thursday: 'J'`, `friday: 'V'`.
4. **Turno**: reemplazar los iconos (`SunLight`, `HalfMoon`, `Sparks`) por texto en un
   chip/badge:
   - `morning → 'AM'`, `afternoon → 'PM'`, `full_day → 'TD'`.
   - Mantener el tooltip con el label largo (Mañana / Tarde / Día completo).
   - Quitar los imports de iconos de horario ya no usados (`SunLight`, `HalfMoon`,
     `Sparks`) si no se usan en otro lado del archivo.
5. **Fila médica nueva**: puntos de color con inicial, mostrando solo las condiciones
   activas. Si no hay ninguna activa, la fila **no se renderiza**.
   - Diabético → `●D`
   - Celíaco → `●C`
   - Hipertenso → `●H`
   - Cada punto/chip con tooltip mostrando el nombre completo al hacer hover.

### Colores de las condiciones médicas

| Condición   | Inicial | Color sugerido |
|-------------|---------|----------------|
| Diabético   | D       | azul (`blue`)  |
| Celíaco     | C       | ámbar (`amber`)|
| Hipertenso  | H       | rojo (`red`)   |

Definir un mapa de config local en `ClientList.jsx`, p. ej.:

```js
const MEDICAL_FLAGS = [
  { key: 'isDiabetic', label: 'Diabético', initial: 'D', color: 'bg-blue-500' },
  { key: 'isCeliac', label: 'Celíaco', initial: 'C', color: 'bg-amber-500' },
  { key: 'isHypertensive', label: 'Hipertenso', initial: 'H', color: 'bg-red-500' }
]
```

Render: iterar sobre `MEDICAL_FLAGS`, filtrar por `client.medicalInfo?.[key]`, y para
cada activa mostrar un punto de color + inicial con tooltip (mismo patrón de tooltip
que usa hoy el badge de horario).

## Modelo de datos

### Migración `018_medical_flags.sql`

Basar las recreaciones en las **definiciones vigentes**:
- `clients_full` y `create_client_full` (ambos overloads) → migración 017.
- `update_client_full` → migración 012.

Pasos de la migración:

1. **Agregar columnas** a `medical_info`:
   ```sql
   ALTER TABLE medical_info
     ADD COLUMN IF NOT EXISTS is_diabetic     BOOLEAN NOT NULL DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS is_celiac       BOOLEAN NOT NULL DEFAULT FALSE,
     ADD COLUMN IF NOT EXISTS is_hypertensive BOOLEAN NOT NULL DEFAULT FALSE;
   ```

2. **Recrear `clients_full`** (copia exacta de la def. de 017) agregando al
   `jsonb_build_object` de `medicalInfo`:
   ```sql
   'isDiabetic', mi.is_diabetic,
   'isCeliac', mi.is_celiac,
   'isHypertensive', mi.is_hypertensive
   ```

3. **Recrear `create_client_full`** (ambos overloads A y B de 017) agregando 3 params
   al final de la firma:
   ```sql
   p_med_is_diabetic     boolean DEFAULT false,
   p_med_is_celiac       boolean DEFAULT false,
   p_med_is_hypertensive boolean DEFAULT false
   ```
   y a la cláusula `INSERT INTO medical_info (...)` las 3 columnas con sus valores.

4. **Recrear `update_client_full`** (def. de 012) agregando 3 params:
   ```sql
   p_med_is_diabetic     boolean DEFAULT NULL,
   p_med_is_celiac       boolean DEFAULT NULL,
   p_med_is_hypertensive boolean DEFAULT NULL
   ```
   - Sumar los flags a la **guarda** del bloque médico:
     `IF ... OR p_med_is_diabetic IS NOT NULL OR p_med_is_celiac IS NOT NULL
     OR p_med_is_hypertensive IS NOT NULL THEN`.
   - Sumarlos al `INSERT INTO medical_info (...)` y al `ON CONFLICT DO UPDATE SET`
     con patrón `COALESCE(EXCLUDED.is_diabetic, medical_info.is_diabetic)`.

   Nota: el frontend siempre envía booleanos (true/false, nunca null) al editar, por lo
   que `COALESCE` persiste correctamente el desmarcado (false). El default NULL solo
   protege llamadas parciales que omitan los flags.

### Notas de compatibilidad

- Los 3 params nuevos tienen default → las firmas RPC son retrocompatibles; las llamadas
  existentes que no los pasen siguen funcionando.
- `create_client_full` tiene dos overloads (con/sin `p_addr_distance_range`). El frontend
  siempre envía `p_addr_distance_range` (overload B), pero se actualizan **ambos** para
  mantener consistencia.

## Capa de servicios

### `src/services/clients/clientTransformers.js`

1. `transformClientToDb`: agregar en la sección Medical info:
   ```js
   p_med_is_diabetic: clientData.medicalInfo?.isDiabetic || false,
   p_med_is_celiac: clientData.medicalInfo?.isCeliac || false,
   p_med_is_hypertensive: clientData.medicalInfo?.isHypertensive || false
   ```
2. `transformUpdateToDb`: dentro de `if (updateData.medicalInfo) { ... }`:
   ```js
   if (updateData.medicalInfo.isDiabetic !== undefined) params.p_med_is_diabetic = updateData.medicalInfo.isDiabetic
   if (updateData.medicalInfo.isCeliac !== undefined) params.p_med_is_celiac = updateData.medicalInfo.isCeliac
   if (updateData.medicalInfo.isHypertensive !== undefined) params.p_med_is_hypertensive = updateData.medicalInfo.isHypertensive
   ```
3. `transformClientFromDb`: agregar los 3 flags (default `false`) al objeto
   `medicalInfo` por defecto.

## Edición — wizard `AddClient` (paso 3)

1. Agregar al `formData` inicial y al hidratar desde `client.medicalInfo`:
   `isDiabetic`, `isCeliac`, `isHypertensive` (default `false`).
2. Nueva sección "Condiciones" en el paso 3 con 3 checkboxes (usar el `Checkbox` de
   `components/ui/Input`): Diabético, Celíaco, Hipertenso.
3. Incluir los 3 flags en el objeto `medicalInfo` que se arma al guardar (≈ línea 255).

## Detalle — `ClientDetail` tab médico (read-only)

En el tab "Información Médica", mostrar las condiciones activas como chips de color
(mismo código de colores que la card). Si no hay ninguna, mostrar "-" o nada.

## Archivos afectados

| Archivo | Cambio |
|---------|--------|
| `supabase/migrations/018_medical_flags.sql` | **Nuevo** — columnas + recrear vista y 3 RPC |
| `src/services/clients/clientTransformers.js` | 3 funciones de transform |
| `src/pages/Clients/AddClient.jsx` | formData + checkboxes paso 3 + guardado |
| `src/pages/Clients/ClientDetail.jsx` | display read-only de flags en tab médico |
| `src/pages/Clients/ClientList.jsx` | rediseño card: contacto, días, turno, tier, fila médica |

## Fuera de alcance (YAGNI)

- No se agregan condiciones médicas adicionales más allá de las 3 pedidas.
- No se cambia la lógica de búsqueda ni los filtros existentes.
- No se toca la facturación ni el calendario de asistencia.

## Verificación

- Compilar Tailwind tras cambios de estilos:
  `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.
- Alta de cliente con flags marcadas → persisten y aparecen en card + detalle.
- Editar cliente desmarcando un flag → se guarda `false` (no queda el valor viejo).
- Cliente sin condiciones → la fila médica no se renderiza en la card.
- Días muestran `L M M J V`; turno muestra `AM`/`PM`/`TD` con tooltip.
- Tier muestra solo la letra, sin "Tier".
