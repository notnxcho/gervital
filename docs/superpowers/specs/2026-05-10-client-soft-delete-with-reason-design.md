# Soft-delete de clientes con motivo

**Fecha:** 2026-05-10
**Estado:** Diseño aprobado

## Contexto

Actualmente al "dar de baja" un cliente se ejecuta un `DELETE` duro sobre `clients`,
que cascada y elimina todo su historial (plan, asistencias, facturas, transporte,
grupos). Esto impide cualquier análisis posterior de retención y bajas, y elimina
información útil para auditoría (historial de facturas pagadas, asistencias).

Queremos:

1. Preservar el cliente y todo su historial cuando se da de baja.
2. Capturar el motivo de la baja (lista discreta) + notas libres.
3. Mantener el operativo limpio (el ex-cliente no debe aparecer en grupos,
   transporte, dashboard, ni en la lista por defecto).
4. Permitir consultar bajas pasadas desde la lista de clientes (toggle).
5. Permitir reactivar a un cliente sin recrear su historial.

## Decisiones clave

- **Soft-delete declarativo (read-side filtering).** Marcamos `deleted_at` en
  `clients` y *no tocamos* ninguna otra tabla. El operativo se mantiene limpio
  porque todas las queries operativas filtran por `deleted_at IS NULL`. Los
  datos relacionados (asignaciones, planificados, memberships) son hechos
  históricos y no deben mutar al cambiar el estado del cliente.
- **Razones discretas, "Otro" exige nota.** 8 motivos predefinidos pensados
  para un club de día de adultos mayores. `'other'` obliga a completar la
  textarea (validado en cliente y en el RPC).
- **Visibilidad opción B.** La lista oculta bajas por default; un toggle
  "Mostrar bajas" las trae. El detalle de un ex-cliente sigue siendo navegable
  (banner superior con motivo + acción de reactivar; operativo deshabilitado).
- **Reactivación trivial.** Limpiar `deleted_at` revive al cliente con todo su
  historial intacto.

### Por qué no "limpiar a futuro" al dar de baja

Alternativa evaluada: ejecutar al momento de la baja una cascada que borre
asignaciones futuras (días planificados, transporte futuro, memberships).
Rechazada porque:

- Viola el principio de que datos históricos/planificados son hechos y no
  deben mutar como side-effect de cambiar el estado del cliente.
- Reactivar implicaría recrear todos esos datos.
- El filtro read-side cubre todos los caminos operativos con cambios mínimos
  (vista + auditoría de pocas queries que tocan tablas directamente).

## Cambios en DB (migración 016)

### `clients` — nuevas columnas

```sql
ALTER TABLE clients
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN deactivation_reason TEXT
    CHECK (deactivation_reason IN (
      'death',
      'transfer_to_other_center',
      'relocation',
      'health_decline',
      'family_decision',
      'financial',
      'service_dissatisfaction',
      'other'
    )),
  ADD COLUMN deactivation_notes TEXT,
  ADD COLUMN deactivated_by UUID REFERENCES users(id);

CREATE INDEX idx_clients_active
  ON clients(deleted_at) WHERE deleted_at IS NULL;

CREATE INDEX idx_clients_deactivation_reason
  ON clients(deactivation_reason) WHERE deleted_at IS NOT NULL;
```

### Constraint de integridad

```sql
ALTER TABLE clients
  ADD CONSTRAINT clients_deactivation_consistency CHECK (
    (deleted_at IS NULL AND deactivation_reason IS NULL
       AND deactivation_notes IS NULL AND deactivated_by IS NULL)
    OR
    (deleted_at IS NOT NULL AND deactivation_reason IS NOT NULL)
  );
```

Y, dentro del RPC (no en el constraint, porque depende del valor):

> Si `deactivation_reason = 'other'`, `deactivation_notes` debe ser NOT NULL
> y trimmed length > 0.

### `clients_full` view

Exponer los 3 campos sin filtrar internamente. El filtro vive en el servicio
(permite `getClientById` traer ex-clientes y `getClients({includeDeleted})`).

```sql
-- Agregar al SELECT:
  c.deleted_at AS "deletedAt",
  c.deactivation_reason AS "deactivationReason",
  c.deactivation_notes AS "deactivationNotes",
```

### RPC `deactivate_client`

```sql
CREATE OR REPLACE FUNCTION deactivate_client(
  p_client_id UUID,
  p_reason TEXT,
  p_notes TEXT,
  p_user_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_reason NOT IN (
    'death','transfer_to_other_center','relocation','health_decline',
    'family_decision','financial','service_dissatisfaction','other'
  ) THEN
    RAISE EXCEPTION 'Invalid deactivation reason: %', p_reason;
  END IF;

  IF p_reason = 'other'
     AND (p_notes IS NULL OR length(trim(p_notes)) = 0) THEN
    RAISE EXCEPTION 'Notes required when reason is "other"';
  END IF;

  UPDATE clients
     SET deleted_at = NOW(),
         deactivation_reason = p_reason,
         deactivation_notes = NULLIF(trim(p_notes), ''),
         deactivated_by = p_user_id,
         updated_at = NOW()
   WHERE id = p_client_id
     AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or already deactivated';
  END IF;

  RETURN p_client_id;
END;
$$;
```

### RPC `reactivate_client`

```sql
CREATE OR REPLACE FUNCTION reactivate_client(p_client_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE clients
     SET deleted_at = NULL,
         deactivation_reason = NULL,
         deactivation_notes = NULL,
         deactivated_by = NULL,
         updated_at = NOW()
   WHERE id = p_client_id
     AND deleted_at IS NOT NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client not found or not deactivated';
  END IF;

  RETURN p_client_id;
END;
$$;
```

## Cambios en servicios

### `clientService.js`

- **Eliminar** `deleteClient(id)`. No mantener backward-compat: la API
  existente no es pública.
- **`getClients(options = {})`**:
  - Default: `.is('deletedAt', null)`.
  - `options.includeDeleted = true` → sin filtro.
- **`getClientById(id)`**: sin cambios (no filtra; permite ver ex-cliente).
- **`deactivateClient(id, { reason, notes })`**: llama RPC
  `deactivate_client`. Toma `userId` del auth context.
- **`reactivateClient(id)`**: llama RPC `reactivate_client`.

### `clientTransformers.js`

Mapear los 3 campos nuevos en `transformClientFromDb`.

### Auditoría de queries existentes

Recorrer y verificar que cada consumidor operativo filtre activos:

| Servicio / pantalla | Camino actual | Acción |
|---|---|---|
| `ClientList` | `getClients()` | Default ya filtra. ✅ |
| `ClientDetail` | `getClientById(id)` | No filtra. Necesario. ✅ |
| `dashboardService.getDashboardMetrics` | `clients_full` directo | Agregar `.is('deletedAt', null)` en la query de clientes. Las queries de facturas y asistencias del mes son históricas y no se tocan. |
| `transportService` (pool del día) | join contra `clients_full` | Agregar filtro `deletedAt IS NULL` al traer el pool de candidatos. Los `transport_trip_counts` históricos del ex-cliente quedan intactos. |
| `groupService` (auto-grouping y carga) | `clients_full` para clientes del día | Filtrar activos al armar el pool. Memberships ya guardados de ex-clientes: al renderizar, si el resolve va contra clientes activos, el ex-cliente desaparece del slot silenciosamente. |
| `attendanceService`, `invoiceService` | acceso por `clientId` | No filtrar (datos históricos). |
| `AddClient` / wizard | crea por RPC | Sin cambios. |

## Cambios en UI

### `DeactivateClientModal.jsx` (nuevo, en `src/pages/Clients/`)

Componente compartido entre `ClientDetail` y `ClientList`.

**Estructura:**

- Header: "Dar de baja a {nombre completo}" + subtítulo
  "Podés reactivarlo después desde el detalle."
- Radio cards (8 opciones, una por motivo). Iconos opcionales.
- Textarea "Notas adicionales" (placeholder dinámico según motivo;
  obligatoria si `reason === 'other'`).
- Botones: "Cancelar" (secondary) / "Confirmar baja" (danger,
  disabled hasta seleccionar motivo).

**Etiquetas en español (UI):**

| key | UI |
|---|---|
| `death` | Fallecimiento |
| `transfer_to_other_center` | Cambio a otra institución |
| `relocation` | Mudanza |
| `health_decline` | Internación / deterioro de salud |
| `family_decision` | Decisión familiar |
| `financial` | Razones económicas |
| `service_dissatisfaction` | Insatisfacción con el servicio |
| `other` | Otro |

**Placeholders sugeridos para "Notas":**

- `service_dissatisfaction` → "¿Qué aspecto puntual? Ayudanos a mejorar."
- `other` → "Describí brevemente el motivo (obligatorio)."
- default → "Información adicional (opcional)."

### `ClientList.jsx`

- Reemplazar `deleteModal` confirm actual por `DeactivateClientModal`.
- Filtro nuevo "Mostrar bajas" (toggle/checkbox) en la barra de filtros.
  - Off (default): `getClients()`.
  - On: `getClients({ includeDeleted: true })`.
- `ClientCard`: si `client.deletedAt`, estilo atenuado (gris,
  opacidad reducida) + badge con motivo y fecha de baja
  ("Baja: Mudanza · 10 may 2026"). El click sigue navegando al detalle.

### `ClientDetail.jsx`

- Reemplazar modal de confirmación actual por `DeactivateClientModal`.
- Si `client.deletedAt`:
  - Banner superior (amarillo o gris) con:
    "Cliente dado de baja el {fecha}. Motivo: {motivo en español}.
    {notas si existen}."
    + botón "Reactivar cliente" (secondary).
  - Ocultar acciones operativas (marcar falta, recuperar día).
  - El calendario, las facturas y el historial permanecen visibles.
- Botón "Dar de baja" del menú de opciones: solo visible si
  `!client.deletedAt`.

## Edge cases

1. **Ex-cliente con grupo/transporte planificado a futuro.** El membership
   o asignación queda en DB pero, al renderizar el día, el resolve contra
   clientes activos lo omite. El slot aparece vacío; el coordinador reordena
   el día. Aceptable y documentado.
2. **Reactivación tras período largo.** Los datos planificados pre-baja
   reaparecen (`assigned_days`, monthly attendance vieja). Si están
   desactualizados, se editan desde la UI normal. No re-creamos datos.
3. **Doble baja.** El RPC falla si ya está dado de baja (`NOT FOUND`).
4. **Reason 'other' sin notas.** Bloqueado en UI (botón disabled) y validado
   en RPC.
5. **Permisos.** Mismo rol que el delete actual (cualquier admin). No
   restringimos a superadmin — si el negocio lo pide después, se ajusta.

## No incluido (futuro)

- Pantalla `/bajas` separada para análisis con métricas de retención.
- Auditoría de quién/cuándo intentó reactivar.
- Exportar reporte de bajas por período.
- Email automático de "lamento que te vayas" / encuesta de salida.

## Resumen de archivos a tocar

- `supabase/migrations/016_client_soft_delete.sql` — nuevo
- `supabase/migrations/004_views.sql` — agregar 3 campos a `clients_full`
- `src/services/clients/clientService.js` — eliminar `deleteClient`,
  agregar `deactivateClient` y `reactivateClient`, modificar `getClients`
- `src/services/clients/clientTransformers.js` — mapear campos
- `src/services/api.js` — re-exports
- `src/services/dashboard/dashboardService.js` — filtro activos
- `src/services/transport/transportService.js` — filtro activos en pool
- `src/services/groups/groupService.js` — filtro activos en pool
- `src/pages/Clients/DeactivateClientModal.jsx` — nuevo
- `src/pages/Clients/ClientList.jsx` — modal + toggle + card atenuado
- `src/pages/Clients/ClientDetail.jsx` — modal + banner + reactivar
