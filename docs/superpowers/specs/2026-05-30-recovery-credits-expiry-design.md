# Días de recupero con vencimiento — Diseño

**Fecha:** 2026-05-30
**Estado:** Aprobado para planificación

## Problema

Hoy `recoveryDaysAvailable` es un contador entero único en `clients`. No hay forma de
expresar que un día de recupero vence. El negocio ahora exige:

- Cada día de recupero vence a los **30 días calendario** de haber sido otorgado.
- En el detalle de cliente, el bloque "Días de recupero" debe ser un **botón** (ícono de
  flecha a la derecha, sub-label con el **vencimiento más próximo**) que abre un modal.
- El modal lista cada crédito con su vencimiento y un botón para **remover** cada uno.
- El header del modal muestra el **conteo total** y un botón **Agregar** para sumar días
  discrecionalmente.

## Decisión central: de contador a créditos individuales

Se reemplaza el contador único por **registros individuales de crédito**. Una tabla nueva
guarda una fila por cada día otorgado/agregado, cada una con su `expires_at`.

El "saldo disponible" pasa a ser un **valor derivado**:

```
disponible = créditos con status='available' AND expires_at >= CURRENT_DATE
```

Con esto el **vencimiento es automático y perezoso**: un crédito deja de contar el día
siguiente a `expires_at` sin necesidad de ningún job/cron. La columna
`clients.recovery_days_available` **se elimina** (single source of truth) y la vista
`clients_full` calcula el conteo desde la tabla de créditos.

### Decisiones tomadas (brainstorming)
- **Migración de saldos existentes:** reconstruir desde `recovery_credit_ledger` (fecha del
  `+1` + 30 días). En la práctica es no-op: el ledger tiene 0 filas y ningún cliente tiene
  `recovery_days_available > 0` hoy. Aun así la migración se escribe robusta.
- **Agregar (discrecional):** `+1` con vencimiento a 30 días desde hoy, con **nota opcional**.
- **Remover:** se **revoca** (`status='revoked'`, queda en la tabla para auditoría), no se borra.
- **Consumo (FIFO):** al usar un día de recupero se consume el crédito con **vencimiento más
  próximo** entre los disponibles.
- **Colores por urgencia:** las filas/labels usan color (ámbar/rojo) cuando el crédito está
  cerca de vencer (≤7 días rojo, ≤14 ámbar, resto neutro).

## Modelo de datos

### Tabla nueva `recovery_credits`

| campo | tipo | significado |
|---|---|---|
| `id` | uuid PK | |
| `client_id` | uuid FK → clients(id) ON DELETE CASCADE | |
| `granted_at` | date NOT NULL | cuándo se ganó/agregó |
| `expires_at` | date NOT NULL | `granted_at + 30 días` |
| `source` | text NOT NULL CHECK in (`justified_absence`,`vacation_post_payment`,`manual`,`migration`) | origen |
| `note` | text NULL | para altas discrecionales |
| `status` | text NOT NULL DEFAULT `available` CHECK in (`available`,`consumed`,`revoked`) | estado (expirado = derivado de `expires_at < today`) |
| `grant_attendance_id` | uuid NULL FK → attendance_records(id) ON DELETE SET NULL | asistencia que lo originó (para deshacer falta/vacación) |
| `consumed_attendance_id` | uuid NULL FK → attendance_records(id) ON DELETE SET NULL | asistencia que lo consumió |
| `consumed_at` | date NULL | |
| `revoked_at` | timestamptz NULL | |
| `created_by_name` | text NULL | actor |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz NOT NULL DEFAULT now() | |

**Índices:** `(client_id, status, expires_at)` para el conteo/listado; `(grant_attendance_id)`
y `(consumed_attendance_id)` para las reversas.

**RLS:** misma política que el resto de tablas (admin + superadmin full access). Espejar la
policy existente de `recovery_credit_ledger`/`attendance_records`.

**`recovery_credit_ledger`:** se conserva como log cronológico. Se le agrega columna nullable
`credit_id uuid` para referenciar el crédito afectado. Las RPCs siguen insertando ahí.

### Vista `clients_full`

Reemplazar:
```sql
c.recovery_days_available AS "recoveryDaysAvailable",
```
por:
```sql
( SELECT count(*)::int FROM recovery_credits rc
  WHERE rc.client_id = c.id
    AND rc.status = 'available'
    AND rc.expires_at >= CURRENT_DATE ) AS "recoveryDaysAvailable",
```
El resto de la vista queda igual (ver Apéndice A para la definición actual completa).

### Eliminar columna

`ALTER TABLE clients DROP COLUMN recovery_days_available;` **después** de recrear la vista y
las RPCs (ninguna debe referenciarla ya).

## RPCs (migración `017_recovery_credits.sql`)

> Helper sugerido: `_recovery_balance(p_client_id uuid) RETURNS int` que devuelve el conteo
> disponible (status='available' AND expires_at >= CURRENT_DATE), reutilizado por las RPCs que
> retornan `recoveryDaysAvailable`.

### Reescritura de RPCs existentes
Todas dejan de tocar `clients.recovery_days_available`. Definiciones actuales en Apéndice B.

- **`mark_day_absent`** (justificada): en vez de `+1` al contador →
  `INSERT INTO recovery_credits (client_id, granted_at, expires_at, source, grant_attendance_id, created_by_name)
   VALUES (p_client_id, p_date, p_date + 30, 'justified_absence', v_record_id, p_created_by)`.
  Ledger: `+1` con `credit_id`. Retornar saldo.
- **`unmark_day_absent`**: en vez de `GREATEST(-1,0)` → borrar el crédito otorgado:
  `DELETE FROM recovery_credits WHERE grant_attendance_id = v_record_id AND status='available'`.
  Si ya estaba `consumed`/`revoked`, no se toca (espeja el viejo flooring en 0). Ledger `-1`.
- **`mark_day_vacation`** (mes pagado): `INSERT` crédito `source='vacation_post_payment'`,
  `grant_attendance_id=v_record_id`, `expires_at=p_date+30`.
- **`unmark_day_vacation`**: borrar crédito `WHERE grant_attendance_id = v_record_id AND status='available'`.
- **`mark_day_recovery_attended`** (consumo FIFO):
  1. Seleccionar el crédito disponible más próximo a vencer:
     `SELECT id ... WHERE client_id=p_client_id AND status='available' AND expires_at >= CURRENT_DATE
      ORDER BY expires_at ASC, granted_at ASC LIMIT 1 FOR UPDATE`.
  2. Si no hay → `{success:false, error:'Sin días de recupero disponibles'}` (mantener mensaje).
  3. Insertar/actualizar `attendance_records` status `recovery` (igual que hoy) → `v_record_id`.
  4. `UPDATE recovery_credits SET status='consumed', consumed_at=p_date, consumed_attendance_id=v_record_id`.
  5. Ledger `-1` con `credit_id`. Retornar saldo.
- **`unmark_day_recovery_attended`**: ubicar la asistencia `recovery` (`v_record_id`); buscar
  crédito por `consumed_attendance_id = v_record_id`; si existe →
  `UPDATE ... SET status='available', consumed_at=NULL, consumed_attendance_id=NULL`. Si no
  existe (datos previos) → fallback: insertar crédito `source='manual'`, `granted_at=CURRENT_DATE`,
  `expires_at=CURRENT_DATE+30`. Luego borrar la asistencia. Ledger `+1`. Retornar saldo.

### RPCs nuevas
- **`add_recovery_credit(p_client_id uuid, p_note text, p_created_by text)`**:
  `INSERT` crédito `source='manual'`, `granted_at=CURRENT_DATE`, `expires_at=CURRENT_DATE+30`,
  `note=p_note`. Ledger `+1`. Retornar `{success, recoveryDaysAvailable}`.
- **`revoke_recovery_credit(p_credit_id uuid, p_created_by text)`**:
  `UPDATE recovery_credits SET status='revoked', revoked_at=now() WHERE id=p_credit_id AND status='available'`.
  Si no afectó filas → `{success:false, error:'Crédito no disponible'}`. Ledger `-1`. Retornar saldo.

### `create_client_full` (ambas sobrecargas)
Quitar `recovery_days_available` del `INSERT INTO clients (...)` (la columna ya no existe). El
default de saldo pasa a ser 0 naturalmente (sin créditos).

## Migración de datos (backfill)

Por cada cliente: replay del `recovery_credit_ledger` ordenado por `(date, created_at)`:
- `change = +1` → push crédito `{granted_at = date, expires_at = date + 30, source='migration'}`.
- `change = -1` → consumir el crédito disponible más próximo a vencer (FIFO).

Insertar en `recovery_credits` los créditos resultantes con su `status` correcto. Fallback:
si un cliente tiene saldo (en datos de prueba) sin ledger consistente, otorgar N créditos
`granted_at = CURRENT_DATE`. **En la BD actual esto no produce filas** (ledger vacío, 0
clientes con saldo).

## Frontend

### Servicio nuevo `src/services/recovery/recoveryService.js`
- `getRecoveryCredits(clientId)` → select de `recovery_credits` con `status='available'` y
  `expires_at >= today`, `order by expires_at asc`. Devuelve `{id, grantedAt, expiresAt, source, note}`.
- `addRecoveryCredit(clientId, note, userName)` → rpc `add_recovery_credit`.
- `revokeRecoveryCredit(creditId, userName)` → rpc `revoke_recovery_credit`.

Re-exportar desde `src/services/api.js`. Seguir convención de servicios (Supabase client directo,
named exports, sin `;` innecesarios, UI en español / código en inglés).

### `ClientDetail.jsx`
- Estado nuevo `recoveryCredits` cargado junto al cliente (`getRecoveryCredits`). Recargar tras
  agregar/revocar y tras operaciones de asistencia que afectan el saldo (marcar/deshacer
  recupero, falta justificada, vacación en mes pagado).
- Reemplazar el bloque `ClientDetail.jsx:384-387` por un **botón** (deshabilitado visualmente si
  no aplica, pero siempre clickeable para abrir el modal y poder agregar):
  - Valor: conteo (`recoveryCredits.length`, igual a `client.recoveryDaysAvailable`).
  - Label: "Días de recupero".
  - Ícono de flecha a la derecha (`NavArrowRight` de iconoir-react).
  - Sub-label: vencimiento más próximo → "Vence el {d MMM}" (más cercano), o "Sin días" si 0.
    Color del sub-label según urgencia (≤7d rojo, ≤14d ámbar, resto gris).
- Abre `RecoveryCreditsModal`.

### Componente nuevo `src/pages/Clients/RecoveryCreditsModal.jsx`
Props: `{ isOpen, onClose, clientId, clientName, credits, onChanged, userName }`.

```
┌─ Días de recupero ───────────────────────────────┐
│  [ 3 ]  días disponibles            [ + Agregar ] │
├───────────────────────────────────────────────────┤
│  Vence el 12 jun · en 13 días     (falta just.) 🗑 │
│  Vence el 28 jun · en 29 días        (manual)   🗑 │
│  Vence el 30 jun · en 31 días     (vacación)    🗑 │
└───────────────────────────────────────────────────┘
```
- Header: título + badge de conteo total; botón "Agregar" (ícono `Plus`) a la derecha.
- "Agregar" despliega un form inline (textarea de nota opcional + botón "Agregar día") que
  llama `addRecoveryCredit` y refresca.
- Cada fila: "Vence el {fecha} · en {N} días", etiqueta de `source` (mapeada a español:
  falta justificada / vacación / manual), nota si existe, y botón remover (ícono `Trash`) →
  `ConfirmModal` → `revokeRecoveryCredit`. Color de fila por urgencia.
- Estado vacío: "No hay días de recupero disponibles".
- Usa componentes `Modal`, `Button`, `ConfirmModal` existentes.
- **Cliente dado de baja:** el botón "Días de recupero" sigue visible (lectura), pero las
  acciones de mutación (Agregar / remover) se ocultan, consistente con el resto de acciones
  operativas ya ocultas en el detalle de clientes desactivados.

### Sin cambios necesarios
- ClientList badge y el gate del calendario (`recoveryDaysAvailable > 0`) siguen funcionando
  porque leen el conteo recalculado por la vista (ahora con vencimiento aplicado).

### Estilos
Recompilar Tailwind: `npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`.

## Verificación
- SQL: aplicar migración en branch/dev; probar grant (falta justificada → crédito a 30d),
  consumo FIFO (con 2 créditos de distinto vencimiento, se consume el más próximo), revoke,
  expiración (crédito con `expires_at` ayer no cuenta en `clients_full` ni en el listado),
  add manual, y las reversas (deshacer falta/recupero/vacación).
- Frontend: el botón muestra conteo + vencimiento más próximo con color; modal lista, agrega
  (con nota), remueve; el calendario respeta el saldo; recompilar Tailwind y verificar en la app.

## Archivos afectados
- **Nuevo:** `supabase/migrations/017_recovery_credits.sql`
- **Nuevo:** `src/services/recovery/recoveryService.js`
- **Nuevo:** `src/pages/Clients/RecoveryCreditsModal.jsx`
- **Editar:** `src/services/api.js` (re-export)
- **Editar:** `src/pages/Clients/ClientDetail.jsx` (estado, botón, modal)

---

## Apéndice A — `clients_full` (definición actual, recortada)
La columna a cambiar es `c.recovery_days_available AS "recoveryDaysAvailable"`; el resto de
joins/JSON se mantienen idénticos (plan, emergencyContact, address, medicalInfo).

## Apéndice B — RPCs actuales (referencia)
`mark_day_absent`, `unmark_day_absent`, `mark_day_vacation`, `unmark_day_vacation`,
`mark_day_recovery_attended`, `unmark_day_recovery_attended` operan hoy sobre
`clients.recovery_days_available` (+1/-1, con `GREATEST(...,0)` en las reversas) e insertan en
`recovery_credit_ledger`. Definiciones completas capturadas de la BD en vivo durante el diseño
(usar `pg_get_functiondef` para reconfirmar antes de reescribir).
