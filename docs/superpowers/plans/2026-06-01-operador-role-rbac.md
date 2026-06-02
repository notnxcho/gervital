# Tercer rol `operador` + RBAC, gestión de passwords y módulo Sueldos — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar el rol `operador` con una matriz de permisos aplicada en frontend y backend (RLS), resolver creación/reset/borrado de usuarios vía Edge Function segura, y agregar un módulo de Sueldos solo-superadmin.

**Architecture:** RBAC centralizado en `AuthContext` mediante una matriz `FEATURE_ROLES` (feature → roles). Backend refuerza con RLS por rol (helper `is_admin_or_superadmin()`) y restringe tablas financieras (`invoices`, `plan_pricing`) al operador por row-filter (devuelve 0 filas, sin error). Operaciones privilegiadas de auth (crear/borrar usuario, reset password) se mueven a una Edge Function `admin-users` que verifica que el llamador sea superadmin usando la `service_role`. El módulo Sueldos es una nueva tabla `salaries` + servicio + sección UI gated.

**Tech Stack:** React 19, Supabase (Postgres + Auth + Edge Functions Deno), Tailwind 3, date-fns. Sin test runner automatizado: la verificación es `npm run build` (compila CRA), queries SQL vía MCP de Supabase, y checks manuales de login por rol.

**Convenciones del proyecto:** variables/código en inglés, UI en español, sin `;` innecesarios en JS/JSX, marcar mocks con `// MOCKED RES`. Recompilar Tailwind si se agregan clases nuevas: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.

---

## Mapa de archivos

**Crear:**
- `supabase/migrations/020_operador_role.sql` — constraint de rol, default, helper RLS, cambios RLS suppliers/expenses/invoices/plan_pricing, tabla `salaries` + RLS.
- `supabase/functions/admin-users/index.ts` — Edge Function (crear/reset/borrar usuario).
- `src/services/salaries/salaryService.js` — CRUD de `salaries` + constantes de tipos.

**Modificar:**
- `src/context/AuthContext.jsx` — matriz `FEATURE_ROLES`, `roleHasAccess`, `hasAccess`.
- `src/services/users/userService.js` — `createUser`/`deleteUser` vía Edge Function, nuevo `resetPassword`.
- `src/services/api.js` — re-exports nuevos (`resetPassword`, salary service).
- `src/pages/Access/AccessList.jsx` — 3 roles, password inicial, botón reset password.
- `src/components/Layout/Navbar.jsx` — `Accesos` → feature `users`.
- `src/components/Layout/RequireRole.jsx` (crear) + `src/App.js` — guard de ruta `/accesos`.
- `src/pages/Clients/ClientDetail.jsx` — ocultar billing en `MonthCard` para no-`billing`.
- `src/pages/Dashboard/Dashboard.jsx` — ocultar sección financiera para no-`dashboard_financials`.
- `src/pages/Clients/AddClient.jsx` — ocultar preview de precio para no-`billing`.
- `src/pages/Suppliers/SupplierList.jsx` — sección Sueldos gated por `salaries`.

---

## Task 1: Introspección de políticas RLS existentes

**Files:** ninguno (solo lectura vía MCP).

- [ ] **Step 1: Listar políticas actuales de las tablas afectadas**

Usar la tool MCP `mcp__supabase__execute_sql` con:

```sql
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('suppliers', 'expenses', 'invoices', 'plan_pricing')
ORDER BY tablename, cmd;
```

Expected: lista de nombres de policy. Anotar los nombres EXACTOS — se usan en los `DROP POLICY` de la Task 2. Los nombres conocidos del repo (migración 003) son:
- suppliers: `Suppliers are viewable by superadmin only`, `... insertable ...`, `... updatable ...`, `... deletable ...`
- expenses: análogos con "Expenses".
- invoices / plan_pricing: confirmar nombres reales con la query (pueden diferir).

- [ ] **Step 2: Confirmar el nombre del CHECK constraint de rol**

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.users'::regclass AND contype = 'c';
```

Expected: el constraint sobre `role` (probablemente `users_role_check`). Anotar el nombre para el `DROP CONSTRAINT`.

---

## Task 2: Migración 020 — rol operador, RLS y tabla salaries

**Files:**
- Create: `supabase/migrations/020_operador_role.sql`

- [ ] **Step 1: Escribir la migración**

Usar los nombres EXACTOS obtenidos en la Task 1 donde dice `<...>`.

```sql
-- 020_operador_role.sql
-- Tercer rol operador + endurecimiento RLS financiero + tabla salaries

-- 1. Ampliar el CHECK de roles a tres valores
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('operador', 'admin', 'superadmin'));

-- 2. Default del trigger de nuevos usuarios -> operador (menor privilegio)
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (auth_id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'operador')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Helper RLS: admin o superadmin
CREATE OR REPLACE FUNCTION is_admin_or_superadmin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE auth_id = auth.uid() AND role IN ('admin', 'superadmin')
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- 4. suppliers y expenses: de superadmin-only -> cualquier autenticado (los 3 roles)
DROP POLICY IF EXISTS "<suppliers_select_name>" ON suppliers;
DROP POLICY IF EXISTS "<suppliers_insert_name>" ON suppliers;
DROP POLICY IF EXISTS "<suppliers_update_name>" ON suppliers;
DROP POLICY IF EXISTS "<suppliers_delete_name>" ON suppliers;
CREATE POLICY "Suppliers viewable by authenticated"   ON suppliers FOR SELECT USING (is_authenticated());
CREATE POLICY "Suppliers insertable by authenticated" ON suppliers FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Suppliers updatable by authenticated"  ON suppliers FOR UPDATE USING (is_authenticated());
CREATE POLICY "Suppliers deletable by authenticated"  ON suppliers FOR DELETE USING (is_authenticated());

DROP POLICY IF EXISTS "<expenses_select_name>" ON expenses;
DROP POLICY IF EXISTS "<expenses_insert_name>" ON expenses;
DROP POLICY IF EXISTS "<expenses_update_name>" ON expenses;
DROP POLICY IF EXISTS "<expenses_delete_name>" ON expenses;
CREATE POLICY "Expenses viewable by authenticated"   ON expenses FOR SELECT USING (is_authenticated());
CREATE POLICY "Expenses insertable by authenticated" ON expenses FOR INSERT WITH CHECK (is_authenticated());
CREATE POLICY "Expenses updatable by authenticated"  ON expenses FOR UPDATE USING (is_authenticated());
CREATE POLICY "Expenses deletable by authenticated"  ON expenses FOR DELETE USING (is_authenticated());

-- 5. invoices (SELECT) y plan_pricing (SELECT): solo admin+superadmin (operador ve 0 filas)
DROP POLICY IF EXISTS "<invoices_select_name>" ON invoices;
CREATE POLICY "Invoices viewable by admin or superadmin"
  ON invoices FOR SELECT USING (is_admin_or_superadmin());

DROP POLICY IF EXISTS "<plan_pricing_select_name>" ON plan_pricing;
CREATE POLICY "Plan pricing viewable by admin or superadmin"
  ON plan_pricing FOR SELECT USING (is_admin_or_superadmin());

-- 6. Tabla salaries (módulo Sueldos, solo superadmin)
CREATE TABLE salaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind TEXT NOT NULL CHECK (kind IN ('recurring', 'one_time')),
  one_time_type TEXT CHECK (one_time_type IN
    ('aguinaldo', 'despido', 'licencia_vacacional', 'liquidacion', 'otro')),
  concept TEXT,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE salaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Salaries viewable by superadmin"   ON salaries FOR SELECT USING (is_superadmin());
CREATE POLICY "Salaries insertable by superadmin" ON salaries FOR INSERT WITH CHECK (is_superadmin());
CREATE POLICY "Salaries updatable by superadmin"  ON salaries FOR UPDATE USING (is_superadmin());
CREATE POLICY "Salaries deletable by superadmin"  ON salaries FOR DELETE USING (is_superadmin());
```

> Nota: si la query de la Task 1 muestra que `invoices`/`plan_pricing` NO tienen una policy SELECT separada (porque usan una policy `FOR ALL`), reemplazar el `DROP POLICY` + `CREATE POLICY ... FOR SELECT` por: dropear la policy `FOR ALL` y recrear policies separadas (SELECT con `is_admin_or_superadmin()`, e INSERT/UPDATE/DELETE conservando la condición original). Ajustar según el resultado real.

- [ ] **Step 2: Aplicar la migración vía MCP**

Usar `mcp__supabase__apply_migration` con `name: "020_operador_role"` y el SQL anterior.
Expected: aplica sin error.

- [ ] **Step 3: Verificar constraint y tabla**

`mcp__supabase__execute_sql`:
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.users'::regclass AND conname='users_role_check';
SELECT to_regclass('public.salaries');
```
Expected: el CHECK incluye `operador`, `admin`, `superadmin`; `salaries` existe (no NULL).

- [ ] **Step 4: Verificar advisors de seguridad**

Usar `mcp__supabase__get_advisors` con `type: "security"`.
Expected: sin nuevos errores críticos sobre `salaries` (RLS habilitada).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/020_operador_role.sql
git commit -m "feat(db): migration 020 — operador role, financial RLS, salaries table"
```

---

## Task 3: Edge Function `admin-users`

**Files:**
- Create: `supabase/functions/admin-users/index.ts`

- [ ] **Step 1: Escribir la función**

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2'

const INITIAL_PASSWORD = 'Password1234!'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const authHeader = req.headers.get('Authorization') ?? ''

    // Identify the caller from their JWT
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } }
    })
    const { data: { user: caller }, error: callerErr } = await callerClient.auth.getUser()
    if (callerErr || !caller) return json({ error: 'No autenticado' }, 401)

    // Privileged client
    const admin = createClient(supabaseUrl, serviceKey)

    // Caller must be superadmin
    const { data: callerProfile } = await admin
      .from('users').select('role').eq('auth_id', caller.id).single()
    if (!callerProfile || callerProfile.role !== 'superadmin') {
      return json({ error: 'No autorizado' }, 403)
    }

    const body = await req.json()
    const { action } = body

    if (action === 'create') {
      const { name, email, role } = body
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: INITIAL_PASSWORD,
        email_confirm: true,
        user_metadata: { name, role }
      })
      if (error) return json({ error: error.message }, 400)
      return json({ authId: data.user.id })
    }

    if (action === 'reset_password') {
      const { authId } = body
      const { error } = await admin.auth.admin.updateUserById(authId, { password: INITIAL_PASSWORD })
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    if (action === 'delete') {
      const { authId } = body
      const { error } = await admin.auth.admin.deleteUser(authId)
      if (error) return json({ error: error.message }, 400)
      return json({ ok: true })
    }

    return json({ error: 'Acción inválida' }, 400)
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
```

- [ ] **Step 2: Desplegar vía MCP**

Usar `mcp__supabase__deploy_edge_function` con `name: "admin-users"` y el archivo. (Por defecto la función requiere JWT verificado, lo cual queremos.)
Expected: deploy exitoso; aparece en `mcp__supabase__list_edge_functions`.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin-users/index.ts
git commit -m "feat(auth): admin-users edge function (create/reset/delete users)"
```

---

## Task 4: AuthContext — matriz de permisos

**Files:**
- Modify: `src/context/AuthContext.jsx:156-170`

- [ ] **Step 1: Reemplazar `hasAccess` por la matriz**

Reemplazar el bloque actual (líneas ~156-170):

```javascript
  // Check if the user has access to a feature based on role
  const hasAccess = (feature) => {
    if (!profile) return false

    // Superadmin has access to everything
    if (profile.role === 'superadmin') return true

    // Admin doesn't have access to these features
    const restrictedForAdmin = ['suppliers', 'statistics']
    if (profile.role === 'admin' && restrictedForAdmin.includes(feature)) {
      return false
    }

    return true
  }
```

por:

```javascript
  // Check if the user has access to a feature based on role
  const hasAccess = (feature) => {
    if (!profile) return false
    return roleHasAccess(profile.role, feature)
  }
```

- [ ] **Step 2: Agregar la matriz y el helper exportado (arriba del componente, tras los imports, ~línea 4)**

Insertar después de `const AuthContext = createContext(null)`:

```javascript
// Feature -> roles allowed. Single source of truth for RBAC.
const FEATURE_ROLES = {
  clients: ['operador', 'admin', 'superadmin'],
  suppliers: ['operador', 'admin', 'superadmin'],
  billing: ['admin', 'superadmin'],
  salaries: ['superadmin'],
  dashboard_financials: ['superadmin'],
  users: ['superadmin'],
  statistics: ['superadmin']
}

// Pure helper usable outside the hook (e.g. in nested components with only `role`)
export function roleHasAccess(role, feature) {
  const allowed = FEATURE_ROLES[feature]
  return Array.isArray(allowed) && allowed.includes(role)
}
```

- [ ] **Step 3: Verificar compilación**

Run: `npx eslint src/context/AuthContext.jsx`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/context/AuthContext.jsx
git commit -m "feat(auth): permission matrix with operador role"
```

---

## Task 5: userService — Edge Function para create/delete/reset

**Files:**
- Modify: `src/services/users/userService.js`

- [ ] **Step 1: Agregar helper de invocación (tras el import de la línea 1)**

```javascript
// Invoke the admin-users edge function, surfacing the server error message
async function invokeAdminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    let message = error.message
    try {
      const ctx = await error.context?.json?.()
      if (ctx?.error) message = ctx.error
    } catch (_) { /* ignore parse errors */ }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
```

- [ ] **Step 2: Reemplazar `createUser` (líneas ~49-83)**

```javascript
/**
 * Create a new user via the admin-users edge function.
 * Initial password is set server-side to the project default.
 * @param {object} userData - { name, email, role }
 * @returns {Promise<object>}
 */
export async function createUser(userData) {
  const data = await invokeAdminUsers({
    action: 'create',
    name: userData.name,
    email: userData.email,
    role: userData.role
  })

  // The handle_new_user trigger creates the profile; wait then fetch it
  await new Promise(resolve => setTimeout(resolve, 500))

  const { data: user, error: fetchError } = await supabase
    .from('users_view')
    .select('*')
    .eq('authId', data.authId)
    .single()

  if (fetchError) {
    throw new Error('Usuario creado pero no se pudo recuperar el perfil')
  }

  return user
}
```

- [ ] **Step 3: Reemplazar `deleteUser` (líneas ~124-161)**

```javascript
/**
 * Delete a user. Removes the auth user (cascades to public.users).
 * @param {string} id - public.users.id
 */
export async function deleteUser(id) {
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('auth_id')
    .eq('id', id)
    .single()

  if (fetchError) {
    throw new Error('Usuario no encontrado')
  }

  if (!user.auth_id) {
    const { error } = await supabase.from('users').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return
  }

  await invokeAdminUsers({ action: 'delete', authId: user.auth_id })
}
```

- [ ] **Step 4: Agregar `resetPassword` y borrar `generateTempPassword`**

Borrar la función `generateTempPassword` (líneas ~163-174) y agregar:

```javascript
/**
 * Reset a user's password to the project default. Superadmin only (enforced
 * server-side by the edge function).
 * @param {string} authId - auth.users id
 */
export async function resetPassword(authId) {
  await invokeAdminUsers({ action: 'reset_password', authId })
}
```

- [ ] **Step 5: Re-exportar en api.js**

En `src/services/api.js`, donde se re-exporta userService, agregar `resetPassword` a la lista de exports de users. (Buscar la línea que exporta `createUser, updateUser, deleteUser` desde `./users/userService` y añadir `resetPassword`.)

- [ ] **Step 6: Verificar**

Run: `npx eslint src/services/users/userService.js src/services/api.js`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/services/users/userService.js src/services/api.js
git commit -m "feat(users): create/delete/reset via admin-users edge function"
```

---

## Task 6: AccessList — 3 roles, password inicial y reset

**Files:**
- Modify: `src/pages/Access/AccessList.jsx`

- [ ] **Step 1: Actualizar constantes de roles (líneas 10-24)**

```javascript
// MOCKED RES - Opciones de roles
const ROLE_OPTIONS = [
  { value: 'operador', label: 'Operador' },
  { value: 'admin', label: 'Admin' },
  { value: 'superadmin', label: 'Superadmin' }
]

const ROLE_LABELS = {
  operador: 'Operador',
  admin: 'Admin',
  superadmin: 'Superadmin'
}

const ROLE_DESCRIPTIONS = {
  operador: 'Clientes, grupos, transporte, proveedores y gastos (sin información financiera)',
  admin: 'Todo lo del operador + precios, facturación y cobranza',
  superadmin: 'Acceso completo: usuarios, dashboard financiero y sueldos'
}
```

- [ ] **Step 2: Default de rol en crear → operador (líneas 32 y 56)**

Cambiar `role: 'admin'` por `role: 'operador'` en el estado inicial de `formData` (línea 32) y en `openCreateModal` (línea 56).

- [ ] **Step 3: Importar `resetPassword` y `Lock` icon**

Línea 2: `import { Plus, Edit, Trash, Lock } from 'iconoir-react'`
Línea 3: agregar `resetPassword` a los imports desde `'../../services/api'`.

- [ ] **Step 4: Agregar estado y handler de reset password (junto a los otros useState, ~línea 31)**

```javascript
  const [resetModal, setResetModal] = useState({ open: false, user: null })
  const [resetDone, setResetDone] = useState(false)
```

Y un handler (junto a `handleDelete`):

```javascript
  const handleResetPassword = async () => {
    if (!resetModal.user) return
    setFormLoading(true)
    try {
      await resetPassword(resetModal.user.authId)
      setResetDone(true)
    } catch (error) {
      console.error('Error reseteando contraseña:', error)
    } finally {
      setFormLoading(false)
    }
  }
```

- [ ] **Step 5: Actualizar colores de avatar/badge para 3 roles (líneas 168-172 y 194-199)**

Reemplazar las expresiones binarias por un helper. Agregar arriba del componente:

```javascript
const ROLE_BADGE = {
  operador: { bg: 'bg-teal-100', text: 'text-teal-700' },
  admin: { bg: 'bg-indigo-100', text: 'text-indigo-700' },
  superadmin: { bg: 'bg-purple-100', text: 'text-purple-700' }
}
const roleBadge = (role) => ROLE_BADGE[role] || ROLE_BADGE.operador
```

Avatar (líneas 168-176) → usar `roleBadge(user.role).bg` y `.text`:

```javascript
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${roleBadge(user.role).bg}`}>
                      <span className={`font-semibold text-lg ${roleBadge(user.role).text}`}>
                        {user.name.split(' ').map(n => n[0]).join('')}
                      </span>
                    </div>
```

Badge de rol (líneas 194-200):

```javascript
                    <span className={`px-3 py-1 text-sm font-medium rounded-full ${roleBadge(user.role).bg} ${roleBadge(user.role).text}`}>
                      {ROLE_LABELS[user.role]}
                    </span>
```

- [ ] **Step 6: Agregar botón "Resetear contraseña" en la fila de acciones (tras el botón Edit, ~línea 209)**

```javascript
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setResetDone(false); setResetModal({ open: true, user }) }}
                        title="Resetear contraseña"
                      >
                        <Lock className="w-4 h-4" />
                      </Button>
```

- [ ] **Step 7: Reemplazar el aviso de email por la contraseña inicial (líneas 258-263)**

```javascript
          {!editingUser && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-sm text-amber-800">
                Contraseña inicial: <span className="font-mono font-semibold">Password1234!</span>
                <br />El usuario podrá cambiarla luego desde su menú.
              </p>
            </div>
          )}
```

- [ ] **Step 8: Actualizar las tarjetas informativas de roles (líneas 129-148) a 3 columnas**

```javascript
      {/* Roles info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <h3 className="font-medium text-gray-900">Operador</h3>
          <p className="text-sm text-gray-500 mt-1">{ROLE_DESCRIPTIONS.operador}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Clientes</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Grupos</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Transporte</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Proveedores</span>
            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">❌ Finanzas</span>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="font-medium text-gray-900">Admin</h3>
          <p className="text-sm text-gray-500 mt-1">{ROLE_DESCRIPTIONS.admin}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Operación</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Facturación</span>
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Cobranza</span>
            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">❌ Usuarios</span>
            <span className="px-2 py-1 bg-red-100 text-red-700 text-xs rounded">❌ Sueldos</span>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="font-medium text-gray-900">Superadmin</h3>
          <p className="text-sm text-gray-500 mt-1">{ROLE_DESCRIPTIONS.superadmin}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">✓ Todo</span>
          </div>
        </Card>
      </div>
```

- [ ] **Step 9: Agregar el modal de reset password (tras el modal de delete, antes del cierre del componente)**

```javascript
      {/* Reset password modal */}
      <Modal
        isOpen={resetModal.open}
        onClose={() => setResetModal({ open: false, user: null })}
        title="Resetear contraseña"
      >
        {resetDone ? (
          <>
            <p className="text-gray-600 mb-6">
              La contraseña de <span className="font-semibold">{resetModal.user?.name}</span> se
              restableció a <span className="font-mono font-semibold">Password1234!</span>.
              Comunicásela al usuario.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => setResetModal({ open: false, user: null })}>Listo</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-gray-600 mb-6">
              ¿Resetear la contraseña de <span className="font-semibold">{resetModal.user?.name}</span> a
              la contraseña inicial <span className="font-mono font-semibold">Password1234!</span>?
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setResetModal({ open: false, user: null })}>
                Cancelar
              </Button>
              <Button onClick={handleResetPassword} loading={formLoading}>
                Resetear
              </Button>
            </div>
          </>
        )}
      </Modal>
```

- [ ] **Step 10: Verificar**

Run: `npx eslint src/pages/Access/AccessList.jsx`
Expected: sin errores.

- [ ] **Step 11: Commit**

```bash
git add src/pages/Access/AccessList.jsx
git commit -m "feat(access): 3-role support, initial password, reset password"
```

---

## Task 7: Navbar + guard de ruta `/accesos`

**Files:**
- Modify: `src/components/Layout/Navbar.jsx:29`
- Create: `src/components/Layout/RequireRole.jsx`
- Modify: `src/App.js`

- [ ] **Step 1: Cambiar feature del item Accesos (Navbar.jsx línea 29)**

```javascript
    { to: '/accesos', label: 'Accesos', icon: Settings, access: 'users' }
```

- [ ] **Step 2: Crear el guard de ruta**

`src/components/Layout/RequireRole.jsx`:

```javascript
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

// Route guard: renders children only if the user has access to `feature`,
// otherwise redirects to the dashboard.
export default function RequireRole({ feature }) {
  const { hasAccess } = useAuth()
  if (!hasAccess(feature)) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
```

- [ ] **Step 3: Envolver la ruta `/accesos` en App.js**

Importar el guard (tras los imports de pages):

```javascript
import RequireRole from './components/Layout/RequireRole'
```

Reemplazar la línea `<Route path="accesos" element={<AccessList />} />` por:

```javascript
            <Route element={<RequireRole feature="users" />}>
              <Route path="accesos" element={<AccessList />} />
            </Route>
```

- [ ] **Step 4: Verificar**

Run: `npx eslint src/components/Layout/Navbar.jsx src/components/Layout/RequireRole.jsx src/App.js`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/components/Layout/Navbar.jsx src/components/Layout/RequireRole.jsx src/App.js
git commit -m "feat(routing): restrict /accesos to superadmin via RequireRole guard"
```

---

## Task 8: ClientDetail — ocultar billing al operador

**Files:**
- Modify: `src/pages/Clients/ClientDetail.jsx`

`MonthCard` ya recibe el prop `user` (línea 614). Usamos `roleHasAccess(user?.role, 'billing')`.

- [ ] **Step 1: Importar el helper (junto al import de useAuth, línea 33)**

```javascript
import { useAuth, roleHasAccess } from '../../context/AuthContext'
```

- [ ] **Step 2: Calcular `canViewBilling` dentro de MonthCard (tras la desestructuración de props / cerca de la línea 643)**

Agregar:

```javascript
  const canViewBilling = roleHasAccess(user?.role, 'billing')
```

- [ ] **Step 3: Envolver el bloque de badges Payment+Invoice (líneas 768-861)**

Envolver todo el `<div className="flex gap-2"> ... </div>` (que contiene ambos badges) en:

```javascript
          {canViewBilling && (
            <div className="flex gap-2">
              {/* ...badges de payment e invoice sin cambios... */}
            </div>
          )}
```

- [ ] **Step 4: Ocultar el monto `$` del stats row (líneas 874-876)**

Reemplazar:

```javascript
            <span className="ml-auto text-base font-bold text-gray-900">
              ${displayAmount.toLocaleString()}
            </span>
```

por:

```javascript
            {canViewBilling && (
              <span className="ml-auto text-base font-bold text-gray-900">
                ${displayAmount.toLocaleString()}
              </span>
            )}
```

> El stats row de conteos (`{chargeableDays}/{fullMonthDays}`, recovery, vacación) y el calendario completo permanecen visibles y editables para el operador.

- [ ] **Step 5: Verificar**

Run: `npx eslint src/pages/Clients/ClientDetail.jsx`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Clients/ClientDetail.jsx
git commit -m "feat(clients): hide billing header from operador in client detail"
```

---

## Task 9: Dashboard — ocultar sección financiera

**Files:**
- Modify: `src/pages/Dashboard/Dashboard.jsx`

- [ ] **Step 1: Importar useAuth y obtener hasAccess**

Agregar el import (junto a los otros imports de Dashboard):

```javascript
import { useAuth } from '../../context/AuthContext'
```

Dentro del componente Dashboard, junto a los otros hooks:

```javascript
  const { hasAccess } = useAuth()
```

- [ ] **Step 2: Envolver el KPI row + grid financiero (líneas ~113-220, hasta cerrar la Card "Estado de cobros" y "Alertas")**

Envolver el `<div className="flex gap-4 flex-wrap">` (KPI row, ~113-149) y el `<div className="grid grid-cols-1 md:grid-cols-2 gap-4">` (sección financiera, ~151 hasta su `</div>` de cierre tras la Card de Alertas, ~286) dentro de:

```javascript
          {hasAccess('dashboard_financials') && (
            <>
              {/* KPI row: 5 stat cards */}
              <div className="flex gap-4 flex-wrap"> ... </div>

              {/* Financial performance section */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4"> ... </div>
            </>
          )}
```

El resto del Dashboard (secciones operativas: clientes por tier, asistencia, lista de clientes) queda visible para todos.

- [ ] **Step 3: Verificar**

Run: `npx eslint src/pages/Dashboard/Dashboard.jsx`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboard/Dashboard.jsx
git commit -m "feat(dashboard): restrict financial section to superadmin"
```

---

## Task 10: AddClient — ocultar preview de precio

**Files:**
- Modify: `src/pages/Clients/AddClient.jsx`

- [ ] **Step 1: Importar useAuth y obtener hasAccess**

```javascript
import { useAuth } from '../../context/AuthContext'
```

Dentro del componente:

```javascript
  const { hasAccess } = useAuth()
```

- [ ] **Step 2: Envolver el bloque "Price preview" (líneas ~614-628)**

Envolver el `{/* Price preview */}` y su contenedor en:

```javascript
              {hasAccess('billing') && (
                <>
                  {/* Price preview ... bloque existente sin cambios ... */}
                </>
              )}
```

> El operador crea/edita clientes pero no ve el precio mensual estimado.

- [ ] **Step 3: Verificar**

Run: `npx eslint src/pages/Clients/AddClient.jsx`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Clients/AddClient.jsx
git commit -m "feat(clients): hide price preview from operador in client wizard"
```

---

## Task 11: salaryService — CRUD de Sueldos

**Files:**
- Create: `src/services/salaries/salaryService.js`
- Modify: `src/services/api.js`

- [ ] **Step 1: Crear el servicio**

`src/services/salaries/salaryService.js`:

```javascript
import { supabase } from '../supabase/client'

// Tipos discretos para costos puntuales (one_time)
export const SALARY_ONE_TIME_TYPES = [
  { value: 'aguinaldo', label: 'Aguinaldo' },
  { value: 'despido', label: 'Despido' },
  { value: 'licencia_vacacional', label: 'Licencia vacacional' },
  { value: 'liquidacion', label: 'Liquidación' },
  { value: 'otro', label: 'Otro' }
]

const SALARY_ONE_TIME_LABELS = SALARY_ONE_TIME_TYPES.reduce((acc, t) => {
  acc[t.value] = t.label
  return acc
}, {})

export function salaryOneTimeLabel(type) {
  return SALARY_ONE_TIME_LABELS[type] || type || ''
}

function mapRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    oneTimeType: row.one_time_type,
    concept: row.concept,
    description: row.description,
    amount: Number(row.amount),
    active: row.active,
    date: row.date,
    createdAt: row.created_at
  }
}

/**
 * Get all salaries (both recurring and one_time), newest first.
 * @returns {Promise<Array>}
 */
export async function getSalaries() {
  const { data, error } = await supabase
    .from('salaries')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw new Error(error.message)
  return data.map(mapRow)
}

/**
 * Create a salary entry.
 * @param {object} input - { kind, oneTimeType?, concept?, description?, amount, date? }
 */
export async function createSalary(input) {
  const payload = {
    kind: input.kind,
    one_time_type: input.kind === 'one_time' ? input.oneTimeType : null,
    concept: input.concept || null,
    description: input.description || null,
    amount: input.amount,
    date: input.kind === 'one_time' ? (input.date || null) : null,
    active: true
  }
  const { data, error } = await supabase
    .from('salaries')
    .insert(payload)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return mapRow(data)
}

/**
 * Update a salary entry (partial).
 * @param {string} id
 * @param {object} input
 */
export async function updateSalary(id, input) {
  const payload = {}
  if (input.concept !== undefined) payload.concept = input.concept
  if (input.description !== undefined) payload.description = input.description
  if (input.amount !== undefined) payload.amount = input.amount
  if (input.oneTimeType !== undefined) payload.one_time_type = input.oneTimeType
  if (input.date !== undefined) payload.date = input.date
  if (input.active !== undefined) payload.active = input.active
  payload.updated_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('salaries')
    .update(payload)
    .eq('id', id)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return mapRow(data)
}

/**
 * Deactivate a recurring salary (baja). Keeps the record for history.
 * @param {string} id
 */
export async function deactivateSalary(id) {
  return updateSalary(id, { active: false })
}

/**
 * Delete a salary entry permanently.
 * @param {string} id
 */
export async function deleteSalary(id) {
  const { error } = await supabase.from('salaries').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
```

- [ ] **Step 2: Re-exportar en api.js**

En `src/services/api.js` agregar:

```javascript
export {
  getSalaries,
  createSalary,
  updateSalary,
  deactivateSalary,
  deleteSalary,
  SALARY_ONE_TIME_TYPES,
  salaryOneTimeLabel
} from './salaries/salaryService'
```

- [ ] **Step 3: Verificar**

Run: `npx eslint src/services/salaries/salaryService.js src/services/api.js`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/services/salaries/salaryService.js src/services/api.js
git commit -m "feat(salaries): salaryService CRUD for recurring/one-time costs"
```

---

## Task 12: Sección Sueldos en SupplierList (solo superadmin)

**Files:**
- Modify: `src/pages/Suppliers/SupplierList.jsx`

- [ ] **Step 1: Imports y hooks**

En los imports de la página agregar:

```javascript
import { useAuth } from '../../context/AuthContext'
```

Y al servicio (línea 14-25, dentro del import de `'../../services/api'`) agregar:
`getSalaries, createSalary, deactivateSalary, deleteSalary, SALARY_ONE_TIME_TYPES, salaryOneTimeLabel`.

Dentro del componente `SupplierList`, junto a los otros hooks:

```javascript
  const { hasAccess } = useAuth()
  const [salaries, setSalaries] = useState([])
  const [salaryModal, setSalaryModal] = useState({ open: false, kind: 'recurring' })
```

- [ ] **Step 2: Cargar sueldos en `loadData` (solo si tiene acceso)**

Dentro de `loadData`, tras setear suppliers/expenses, agregar:

```javascript
      if (hasAccess('salaries')) {
        const salariesData = await getSalaries()
        setSalaries(salariesData)
      }
```

- [ ] **Step 3: Handlers de sueldos (junto a los otros handlers)**

```javascript
  const handleDeactivateSalary = async (id) => {
    try {
      await deactivateSalary(id)
      loadData()
    } catch (error) {
      console.error('Error dando de baja sueldo:', error)
    }
  }

  const handleDeleteSalary = async (id) => {
    try {
      await deleteSalary(id)
      loadData()
    } catch (error) {
      console.error('Error eliminando sueldo:', error)
    }
  }
```

- [ ] **Step 4: Renderizar la sección Sueldos (antes del cierre del `<div>` contenedor, tras la sección de proveedores ~línea 299)**

```javascript
      {/* Sueldos (solo superadmin) */}
      {hasAccess('salaries') && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Sueldos</h3>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setSalaryModal({ open: true, kind: 'recurring' })}
              >
                <Plus className="w-4 h-4" />
                Costo recurrente
              </Button>
              <Button
                onClick={() => setSalaryModal({ open: true, kind: 'one_time' })}
                className="bg-purple-600 hover:bg-purple-700"
              >
                <Plus className="w-4 h-4" />
                Costo puntual
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recurrentes activos */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Recurrentes mensuales</h4>
              {salaries.filter(s => s.kind === 'recurring' && s.active).length === 0 ? (
                <Card className="p-6 text-center"><p className="text-gray-500">Sin costos recurrentes</p></Card>
              ) : (
                <div className="space-y-3">
                  {salaries.filter(s => s.kind === 'recurring' && s.active).map(s => (
                    <Card key={s.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h5 className="font-medium text-gray-900">{s.concept || 'Sin concepto'}</h5>
                          {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-gray-900">${s.amount.toLocaleString('es-AR')}</p>
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 justify-end">
                        <button
                          onClick={() => handleDeactivateSalary(s.id)}
                          className="px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50 rounded-lg transition-colors"
                        >
                          Dar de baja
                        </button>
                        <button
                          onClick={() => handleDeleteSalary(s.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Puntuales */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Puntuales</h4>
              {salaries.filter(s => s.kind === 'one_time').length === 0 ? (
                <Card className="p-6 text-center"><p className="text-gray-500">Sin costos puntuales</p></Card>
              ) : (
                <div className="space-y-3">
                  {salaries.filter(s => s.kind === 'one_time').map(s => (
                    <Card key={s.id} className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h5 className="font-medium text-gray-900">{salaryOneTimeLabel(s.oneTimeType)}</h5>
                            {s.concept && <span className="text-xs text-gray-500">· {s.concept}</span>}
                          </div>
                          {s.description && <p className="text-xs text-gray-400 mt-1">{s.description}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-gray-900">${s.amount.toLocaleString('es-AR')}</p>
                          {s.date && (
                            <p className="text-xs text-gray-400">{format(new Date(s.date), 'd MMM yyyy', { locale: es })}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100 justify-end">
                        <button
                          onClick={() => handleDeleteSalary(s.id)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash className="w-4 h-4" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Agregar el `SalaryModal` (nuevo componente al final del archivo) y renderizarlo**

Renderizar (junto a los otros modales, ~línea 318):

```javascript
      {/* Salary Modal */}
      <SalaryModal
        isOpen={salaryModal.open}
        kind={salaryModal.kind}
        onClose={() => setSalaryModal({ open: false, kind: 'recurring' })}
        onSave={loadData}
      />
```

Componente al final del archivo (tras `ExpenseModal`):

```javascript
// Modal de sueldo (recurrente o puntual)
function SalaryModal({ isOpen, kind, onClose, onSave }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    oneTimeType: 'aguinaldo',
    concept: '',
    description: '',
    amount: '',
    date: ''
  })

  useEffect(() => {
    setForm({ oneTimeType: 'aguinaldo', concept: '', description: '', amount: '', date: '' })
  }, [isOpen, kind])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      await createSalary({
        kind,
        oneTimeType: form.oneTimeType,
        concept: form.concept,
        description: form.description,
        amount: parseFloat(form.amount),
        date: form.date
      })
      onSave()
      onClose()
    } catch (error) {
      console.error('Error guardando sueldo:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={kind === 'recurring' ? 'Nuevo costo recurrente' : 'Nuevo costo puntual'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {kind === 'one_time' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tipo</label>
            <select
              value={form.oneTimeType}
              onChange={(e) => setForm({ ...form, oneTimeType: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              required
            >
              {SALARY_ONE_TIME_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        )}

        <Input
          label="Concepto"
          value={form.concept}
          onChange={(e) => setForm({ ...form, concept: e.target.value })}
          placeholder={kind === 'recurring' ? 'Ej: Sueldo coordinador' : 'Ej: Juan Pérez'}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Monto"
            type="number"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
            placeholder="0"
            required
          />
          {kind === 'one_time' && (
            <Input
              label="Fecha"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notas</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="Detalles adicionales..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-3 justify-end pt-4">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={loading}>Guardar</Button>
        </div>
      </form>
    </Modal>
  )
}
```

- [ ] **Step 6: Verificar**

Run: `npx eslint src/pages/Suppliers/SupplierList.jsx`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Suppliers/SupplierList.jsx
git commit -m "feat(salaries): Sueldos section in suppliers page (superadmin only)"
```

---

## Task 13: Build, Tailwind y verificación end-to-end

**Files:** ninguno nuevo (verificación).

- [ ] **Step 1: Recompilar Tailwind**

Se agregaron clases nuevas (teal-100/teal-700 en AccessList). Run:
```bash
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css
```
Expected: regenera sin error.

- [ ] **Step 2: Build de producción (verifica compilación completa)**

```bash
CI=true npm run build
```
Expected: `Compiled successfully` (warnings de lint preexistentes aceptables, sin errores).

- [ ] **Step 3: Verificación RLS por rol vía MCP**

Comprobar que un operador no ve invoices. Crear (si no existe) un usuario operador de prueba, o usar `execute_sql` con `SET request.jwt.claims` no es trivial; en su lugar verificar las policies aplicadas:
```sql
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('invoices','plan_pricing','suppliers','expenses','salaries')
ORDER BY tablename, cmd;
```
Expected: `invoices`/`plan_pricing` SELECT usan `is_admin_or_superadmin()`; `suppliers`/`expenses` usan `is_authenticated()`; `salaries` todas con `is_superadmin()`.

- [ ] **Step 4: Checklist manual de login por rol (ejecutar `npm start`)**

Verificar manualmente (o documentar para el usuario) iniciando sesión con cada rol:
- **operador:** NO ve "Accesos" en navbar; ve Proveedores/Gastos SIN sección Sueldos; en detalle de cliente ve el calendario y puede marcar faltas/recuperos, pero NO ve montos `$`, ni badges de cobranza/facturación; Dashboard sin sección financiera; AddClient sin preview de precio.
- **admin:** ve cobranza/facturación/montos en detalle de cliente; Dashboard SIN sección financiera; NO ve Accesos ni Sueldos.
- **superadmin:** ve todo, incluido Accesos (con reset password), Dashboard financiero y Sueldos.

- [ ] **Step 5: Commit final (Tailwind output)**

```bash
git add src/tailwind.output.css
git commit -m "chore(styles): recompile tailwind for operador role UI"
```

---

## Self-Review (cobertura del spec)

- ✅ Rol `operador` en constraint + default + matriz (Tasks 2, 4).
- ✅ Matriz de permisos (clients/suppliers/billing/salaries/dashboard_financials/users) (Task 4).
- ✅ Decisión: dashboard financiero solo-superadmin (Task 9).
- ✅ RLS: helper `is_admin_or_superadmin`, suppliers/expenses abiertos, invoices/plan_pricing restringidos (Task 2).
- ✅ Tabla `salaries` + RLS superadmin (Task 2).
- ✅ Edge Function create/reset/delete, verificación superadmin, password `Password1234!` (Task 3).
- ✅ userService vía edge function + `resetPassword` (Task 5).
- ✅ AccessList: 3 roles, password inicial, botón reset, colores, tarjetas (Task 6).
- ✅ Accesos solo-superadmin (navbar + guard de ruta) (Task 7).
- ✅ ClientDetail oculta billing, mantiene calendario editable (Task 8).
- ✅ Dashboard oculta financiero (Task 9).
- ✅ AddClient oculta precio (Task 10).
- ✅ Módulo Sueldos UI (recurrentes alta/baja + puntuales con tipos discretos) (Tasks 11-12).
- ✅ Build + Tailwind + verificación por rol (Task 13).
```
