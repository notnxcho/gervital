# Tercer rol de usuario: `operador` + RBAC, gestión de passwords y módulo Sueldos

**Fecha:** 2026-06-01
**Estado:** Aprobado para implementación

## Objetivo

Introducir un tercer rol (`operador`) además de `admin` y `superadmin`, con una matriz de
permisos clara aplicada en frontend **y** backend (RLS). Resolver de forma segura la
creación de usuarios, el reset de contraseñas (sin sistema de mailing) y agregar un módulo
de Sueldos solo-superadmin dentro de Proveedores/Gastos.

## Jerarquía de roles

`operador` < `admin` < `superadmin`

- **Operador**: empleados del centro que ejecutan actividades y coordinación operativa.
  Crean y gestionan clientes, grupos y transporte. Acceden a Proveedores y Gastos. En el
  detalle de cliente ven y **editan** el calendario de asistencia, pero NO ven precio,
  estado de facturación ni estado de cobranza.
- **Admin**: todo lo del operador + información financiera por cliente (precios, montos,
  facturación, cobranza en el header del detalle de cliente).
- **Superadmin**: acceso irrestricto. Único que puede gestionar usuarios de la app, ver la
  parte financiera del Dashboard, y el módulo de Sueldos.

## Matriz de permisos (feature → roles)

| Feature | operador | admin | superadmin | Controla |
|---|:---:|:---:|:---:|---|
| `clients` | ✅ | ✅ | ✅ | Clientes, Grupos, Transporte, Dashboard (operativo) |
| `suppliers` | ✅ | ✅ | ✅ | Proveedores y Gastos |
| `billing` | ❌ | ✅ | ✅ | Precios, montos $, status facturación y cobranza |
| `salaries` | ❌ | ❌ | ✅ | Sección Sueldos (dentro de Proveedores/Gastos) |
| `dashboard_financials` | ❌ | ❌ | ✅ | Parte financiera del Dashboard |
| `users` | ❌ | ❌ | ✅ | Gestión de usuarios (página Accesos) |

**Decisión confirmada:** la parte financiera del Dashboard es estrictamente solo-superadmin.
El admin NO ve métricas financieras en el Dashboard, pero sí ve facturación/cobranza en el
detalle de cada cliente (feature `billing`).

## Backend

### Migración `020_operador_role.sql`

- `users.role` CHECK constraint → `IN ('operador', 'admin', 'superadmin')`
  (drop + add constraint con el nombre existente).
- `handle_new_user()` default role → `'operador'` (menor privilegio por defecto).
- Nuevo helper RLS:
  ```sql
  CREATE OR REPLACE FUNCTION is_admin_or_superadmin()
  RETURNS BOOLEAN AS $$
    SELECT EXISTS (
      SELECT 1 FROM users
      WHERE auth_id = auth.uid() AND role IN ('admin', 'superadmin')
    );
  $$ LANGUAGE sql SECURITY DEFINER;
  ```
- RLS **suppliers** y **expenses**: de `is_superadmin()` → `is_authenticated()` (los 3 roles
  pueden leer/escribir). Drop de las policies viejas + create de las nuevas.
- RLS **invoices** (SELECT) y **plan_pricing** (SELECT): de `is_authenticated()` →
  `is_admin_or_superadmin()` (el operador no puede leer datos financieros vía API).
- Tablas operativas (clients, attendance, monthly_attendance, transport_*, daily_groups*)
  permanecen abiertas a authenticated → el operador edita asistencia y operación.

### Tabla `salaries` (módulo Sueldos)

```sql
CREATE TABLE salaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL CHECK (kind IN ('recurring', 'one_time')),
  -- para one_time: tipo discreto; para recurring: NULL
  one_time_type TEXT CHECK (one_time_type IN
    ('aguinaldo', 'despido', 'licencia_vacacional', 'liquidacion', 'otro')),
  concept TEXT,            -- etiqueta libre (nombre empleado / descripción del recurrente)
  description TEXT,        -- field libre de texto
  amount NUMERIC(12,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,   -- para recurring: alta/baja
  date DATE,               -- para one_time: fecha del costo
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

- RLS: SELECT/INSERT/UPDATE/DELETE solo `is_superadmin()`.
- `salaries` se incluye en la misma migración 020.

### Edge Function `admin-users`

Función Deno/TS desplegada en Supabase. Recibe el JWT del llamador en `Authorization`,
verifica que el rol del llamador sea `superadmin` (consulta a `users` con la service_role),
y solo entonces ejecuta operaciones privilegiadas. Acciones:

- `create` → `auth.admin.createUser({ email, password: 'Password1234!', email_confirm: true,
  user_metadata: { name, role } })`. El trigger `handle_new_user` crea el perfil.
- `reset_password` → `auth.admin.updateUserById(authId, { password: 'Password1234!' })`.
- `delete` → `auth.admin.deleteUser(authId)`.

Usa `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_URL` (inyectadas automáticamente por el runtime).
Devuelve 403 si el llamador no es superadmin.

**Constante de password inicial:** `Password1234!` (definida en la Edge Function).

## Frontend

### `AuthContext.hasAccess(feature)`

Reemplazar la lógica de `if` por una matriz `FEATURE_ROLES` (feature → array de roles).
`hasAccess` devuelve `true` si `profile.role` está en `FEATURE_ROLES[feature]`. Mantener el
guard `if (!profile) return false`.

### `userService.js`

- `createUser({ name, email, role })` → `supabase.functions.invoke('admin-users', { body:
  { action: 'create', ... } })`, luego refetch del perfil creado.
- `resetPassword(authId)` (nuevo) → invoke con `action: 'reset_password'`.
- `deleteUser(id)` → resuelve `auth_id` y luego invoke con `action: 'delete'`.
- `updateUser(id, { name, email, role })` → permanece como UPDATE directo a `users`
  (la RLS de superadmin lo permite). Quitar `generateTempPassword` (ya no se usa).

### `AccessList.jsx` (página solo-superadmin)

- Route guard: redirige si no es superadmin (ver Layout/App).
- `ROLE_OPTIONS`, `ROLE_LABELS`, `ROLE_DESCRIPTIONS` → 3 roles. Colores de avatar/badge:
  operador (slate/teal), admin (indigo), superadmin (purple).
- Tarjetas informativas de roles → 3 tarjetas con sus capacidades.
- Modal crear: reemplazar el mensaje de email por *"Contraseña inicial: `Password1234!`"*.
- Nuevo botón **Resetear contraseña** por usuario → modal de confirmación → llama a
  `resetPassword(user.authId)` → muestra mensaje de éxito con la contraseña a comunicar.

### `Navbar.jsx` / rutas

- Item `Accesos`: `access: 'access'` → `access: 'users'`.
- Item `Proveedores`: sigue con `suppliers` (ahora pasa para los 3 roles).
- Guard de ruta `/accesos`: solo superadmin (redirección a `/dashboard` si no).

### `ClientDetail.jsx`

Envolver con `hasAccess('billing')`:
- Badge de cobranza (payment status) — sección ~770-815.
- Badge de facturación (invoice status) — sección ~818-860.
- El monto `$` en el stats row — ~864-877 (mostrar solo `chargeableDays/fullMonthDays` y
  recovery/vacation al operador, ocultar el `$`).

El operador conserva el calendario, los conteos y la edición de estados de asistencia.

### `Dashboard.jsx`

Métricas financieras (revenue, facturación, cobranza) detrás de
`hasAccess('dashboard_financials')` (solo superadmin). El resto (métricas operativas:
clientes, asistencia) queda visible para todos.

### `AddClient.jsx` y `ClientList.jsx`

Ocultar "precio estimado"/montos `$` para quien no tenga `hasAccess('billing')`.

### Módulo Sueldos (UI)

Sección/tab "Sueldos" dentro de la página de Proveedores/Gastos, gated por
`hasAccess('salaries')` (solo superadmin). Dos bloques:

1. **Costos recurrentes mensuales** (`kind: 'recurring'`): lista con alta (concept, amount,
   description libre) y baja (toggle `active = false`).
2. **Costos puntuales** (`kind: 'one_time'`): lista con alta (selector de tipo discreto
   [aguinaldo, despido, licencia_vacacional, liquidacion, otro], amount, description libre,
   date).

Nuevo `salaryService.js` con CRUD sobre `salaries`. Constantes de tipos en el service o en
un archivo de constantes del dominio.

## Plan de verificación

- Migración 020 aplica sin error; CHECK acepta los 3 roles.
- Edge Function: superadmin puede crear/resetear/borrar; un admin/operador recibe 403.
- Login con un usuario `operador`: no ve Accesos, no ve `$`/facturación/cobranza en detalle
  de cliente ni en Dashboard, pero sí ve y edita el calendario; ve Proveedores/Gastos sin
  la sección Sueldos.
- Login `admin`: ve facturación/cobranza por cliente, NO ve Dashboard financiero ni Sueldos
  ni Accesos.
- Login `superadmin`: ve todo, incluido Sueldos y reset de password.
- RLS: un operador autenticado no puede `SELECT` de `invoices`/`plan_pricing` vía API.
- Build de Tailwind regenerado si hubo clases nuevas.

## Fuera de alcance

- Sistema de mailing / invitaciones por email.
- Reportes o lógica de cálculo sobre sueldos (solo alta/baja/listado por ahora).
- Detalle avanzado del módulo Sueldos (se profundizará luego).
