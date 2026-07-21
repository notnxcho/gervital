# Modelo unificado de faltas — Diseño

**Fecha:** 2026-07-20
**Estado:** Aprobado para plan de implementación
**Autor:** Nacho + Claude

---

## Objetivo

Unificar la lógica de faltas para que el criterio sea **completo y predecible**, con una
única fuente de verdad server-side. Hoy la lógica está fragmentada: "Justificada" siempre
se guarda como status `vacation` (día no cobrado) y el crédito de recupero se otorga solo
si el mes ya está pago — ignorando por completo la distinción hoy/futuro que sí exige el
negocio.

Se elimina el status legacy `vacation` (un tipo rígido que hardcodea "justificada + no
cobrable" bajo un nombre que miente sobre el dato — una enfermedad marcada a futuro en un
mes impago es "no cobrable" y no tiene nada que ver con vacaciones).

Fuera de alcance en esta iteración: el flujo "pide devolución" (flecha amarilla del chart)
que abriría edición de cobranza para descobrar un día ya pago. Se aborda por separado.

---

## Regla de negocio (fuente: chart aprobado)

Una falta se decide con tres entradas: **cuándo** es (hoy/pasado vs futuro), **si está
justificada**, y —solo para futuro+justificada— **si el mes está pago**.

| Caso | ¿Cobra? | Recupero |
|---|---|---|
| Injustificada (cualquier fecha) | ✅ Sí | — |
| Justificada — hoy o pasado | ✅ Sí | **+1** |
| Justificada — futuro + mes pago | ✅ Sí | **+1** |
| Justificada — futuro + mes NO pago | ❌ No | — |

Decisiones confirmadas con el usuario:

1. **Los días con +recupero SE COBRAN.** El recupero es la compensación por haber pagado un
   día que no se usó. Solo el caso *futuro + mes no pago* queda sin cobrar. Invariante:
   `+recupero ⟺ se cobra el día`; `no cobrable ⟺ sin recupero`.
2. **Días pasados se tratan como "en el día"** (justificada → +recupero cobrable, sin
   depender del estado de pago). El chart solo dibuja hoy/futuro; extendemos "hoy" hacia atrás.
3. **La vigencia del recupero corre desde la fecha de la falta** (`expires_at = fecha_falta
   + 30`). El día de creación del crédito se registra igual, vía `created_at`.

---

## Modelo de datos: una sola falta, descrita por atributos

**Toda falta es status `absent`.** Su significado se captura con atributos ortogonales sobre
el registro, no con buckets de status:

| Atributo | Tipo | Significado |
|---|---|---|
| `is_justified` | boolean (ya existe) | ¿Tuvo justificación? |
| `is_chargeable` | boolean (**nuevo**) | ¿Se factura el día? **Se fija al marcar.** |
| `notes` | text (ya existe) | El motivo — chip + texto libre. Ahora se usa para **toda** falta |

Invariante central que gobierna el recupero:

> **Se genera crédito de recupero ⟺ `is_justified AND is_chargeable`.**

Derivación de los dos booleanos al momento de marcar:

```
is_justified  = entrada del usuario (Justificada / No justificada)
is_future     = fecha > CURRENT_DATE
month_paid    = monthly_invoices.payment_status = 'paid' para (client, año, mes de la fecha)

is_chargeable = NOT (is_justified AND is_future AND NOT month_paid)
```

Es decir, `is_chargeable = false` **solo** cuando `justificada AND futuro AND no-pago`. En
todos los demás casos es `true`. El combo `(is_justified=false, is_chargeable=false)`
(injustificada no cobrable) es inválido por diseño y nunca se produce.

**`is_chargeable` se persiste al marcar** — la decisión queda permanente y predecible. Un
pago posterior del mes NO reescribe faltas ya marcadas. (Consistente: el descuento de una
falta "no cobrable" en un mes impago ya se refleja en la factura eventual.)

Para statuses distintos de `absent`: `is_chargeable` default `true` (irrelevante para
`scheduled`; `attended` y `recovery` se cobran).

---

## RPCs (fuente de verdad server-side)

Se **eliminan**: `mark_day_vacation`, `unmark_day_vacation`, `mark_vacation_range`.
Se **reemplazan** por una familia unificada:

### `register_absence(p_client_id, p_date, p_is_justified, p_notes, p_created_by)`
1. Deriva `is_future` y `month_paid` (lookup a `monthly_invoices`).
2. Deriva `is_chargeable` con la fórmula de arriba.
3. Upsert de `attendance_records`: status `absent`, `is_justified`, `is_chargeable`,
   `notes = NULLIF(trim(p_notes),'')`.
4. Si `is_justified AND is_chargeable`: inserta crédito en `recovery_credits`
   (`granted_at = p_date`, `expires_at = p_date + 30`, `source = 'justified_absence'`,
   `note = p_notes` — **forward del motivo**, `grant_attendance_id`, `created_by_name`).
   Idempotente: no duplica crédito si ya existe uno vivo para ese `grant_attendance_id`.
5. Escribe entrada en `recovery_credit_ledger` cuando corresponde.

### `register_absence_range(p_client_id, p_from, p_to, p_is_justified, p_notes, p_created_by)`
Recorre los días asignados del rango y llama la lógica de `register_absence` por día. Cada
día se evalúa independientemente, así un rango que cruza la frontera hoy/pago resuelve
`is_chargeable` correcto por día. (Hoy el rango solo se ofrece para justificadas.)

### `unregister_absence(p_client_id, p_date, p_created_by)`
Reversa unificada: si la falta tenía crédito asociado (`grant_attendance_id`), lo revoca
(`status='revoked'`, `revoked_at`, ledger). Restaura el status del día según la fecha:
`scheduled` si es futuro, `attended` si es hoy/pasado (alineado con migración 067).

`mark_day_absent` puede quedar como wrapper interno o absorberse dentro de
`register_absence`; el frontend solo llama la familia `register_*`.

---

## Facturación

`is_chargeable` es el primitivo. Un día resta del cobro **⟺** es `absent AND
is_chargeable = false`.

- **SQL `calculate_month_billing`** (`009_billing_v2.sql`): reemplazar el conteo de
  `vacationDays` (status `vacation`) por `nonChargeableDays` = días asignados con status
  `absent AND is_chargeable = false`. `chargeable_days = planned_days - nonChargeableDays`.
  El resto del cálculo (monto proporcional, recovery days contados aparte) se mantiene.
- **Mirror frontend** (`ClientDetail.jsx` `MonthCard`, ~904-958): mismo cambio —
  `chargeableDays = plannedDays - nonChargeableDays`. Meses finalizados (pago/facturado)
  siguen usando el snapshot de la factura (congelado, sin cambio).

`attendance_view` debe exponer `is_chargeable` (como `isChargeable`) para que el mirror y el
display lo consuman.

---

## Display (calendario + modal)

El color/label se derivan de los atributos, no del nombre de status
(`getDayStyle` / `getDayTooltip` en `ClientDetail.jsx`, ~107-128):

| Caso | Color | Label |
|---|---|---|
| `absent`, injustificada | rojo (`bg-red-500`) | "Falta no justificada" |
| `absent`, justificada + cobrable | rojo claro (`bg-red-300`) | "Falta justificada (+1 recupero)" |
| `absent`, justificada + no cobrable | naranja (`bg-orange-400`) | "Falta justificada (no cobrable)" |
| `recovery` | azul | "Día recuperado" |
| `attended` / `scheduled` | verde / gris | "Asistió" / "Programado" |

El motivo (`notes`) se anexa al tooltip en toda falta cuando existe.

**Modal `AbsenceModal`:** el banner ámbar informativo se reemplaza por un **preview de
resultado predecible**, derivado client-side de la fecha seleccionada + `isPaid`:
- Justificada donde `is_chargeable` resultará `true`: *"Se cobra el día y se acredita 1
  recupero."*
- Justificada donde `is_chargeable` resultará `false` (futuro + no pago): *"No se cobra el
  día (sin recupero)."*
- No justificada: *"Se cobra el día igual. Sin crédito de recupero."*

El modal sigue pidiendo únicamente **Justificada vs No justificada** + motivo (+ rango
opcional para justificadas). El sistema deriva el resto.

---

## Migración (068)

1. `ALTER TABLE attendance_records ADD COLUMN is_chargeable BOOLEAN NOT NULL DEFAULT true`.
2. Backfill: registros con status `vacation` → `status = 'absent'`, `is_justified = true`,
   `is_chargeable = false` (preservando `notes`). Registros `absent` existentes son
   históricamente injustificados (el UI ruteaba justificadas a `vacation`), conservan
   `is_chargeable = true`. **La migración NO toca `recovery_credits`**: los créditos
   históricos (incluidos los `vacation_post_payment` de meses pagos) quedan intactos, aunque
   sus filas de origen queden como justificada+no-cobrable. El invariante justified∧chargeable
   ⟺ crédito gobierna marcas nuevas, no re-deriva datos históricos.
3. Recrear `attendance_view` incluyendo `is_chargeable`. **Gotcha conocido:** re-asertar
   `security_invoker` / propiedades si aplica al recrear la vista.
4. Crear `register_absence`, `register_absence_range`, `unregister_absence`.
5. `DROP FUNCTION` de `mark_day_vacation`, `unmark_day_vacation`, `mark_vacation_range`
   (todas las sobrecargas — cuidar acumulación de overloads).
6. Actualizar `calculate_month_billing` para usar `is_chargeable`.
7. Eliminar el CHECK/uso de status `vacation` donde exista constraint sobre
   `attendance_records.status`.

`recovery_credits.source` mantiene su enum; `'vacation_post_payment'` queda obsoleto (no se
emite más) pero se conserva por compatibilidad con filas históricas.

---

## Frontend — cambios

- `attendanceService.js`: reemplazar `markDayVacation` / `unmarkDayVacation` /
  `markVacationRange` por `registerAbsence` / `unregisterAbsence` / `registerAbsenceRange`.
  Exponer `isChargeable` en el objeto día. `markDayAbsent`/`unmarkDayAbsent` quedan
  redirigidos o reemplazados por la familia `register_*`.
- `ClientDetail.jsx`:
  - `onConfirm` del modal colapsa sus tres ramas en `registerAbsence(...)` /
    `registerAbsenceRange(...)`. Undo → `unregisterAbsence(...)`.
  - `handleDayClick`: el ruteo de undo deja de distinguir `vacation`/`absent`; toda falta
    va a un único `'absence'` / undo de falta.
  - `getDayStyle` / `getDayTooltip`: keyed en `is_justified` + `is_chargeable`.
  - `MonthCard`: billing mirror usa `is_chargeable`.
  - Preview de resultado en el modal.
- Recompilar Tailwind si aparecen clases nuevas.

---

## Verificación

Escenarios a demostrar end-to-end (vía flujo real, no SQL directo):

1. Falta **hoy justificada, mes impago** → `absent`, cobrada, **+1 recupero** (cambio de
   comportamiento vs hoy, que la descontaba y no daba crédito).
2. Falta **hoy justificada, mes pago** → cobrada (snapshot congelado), +1 recupero.
3. Falta **futura justificada, mes impago** → `absent` no cobrable, descuento en factura,
   sin recupero.
4. Falta **futura justificada, mes pago** → cobrada, +1 recupero.
5. Falta **injustificada** (hoy y futuro) → cobrada, sin recupero.
6. **Rango** justificado que cruza hoy/pago → cada día resuelve `is_chargeable` correcto.
7. **Undo** de una falta con recupero → revoca el crédito; el día vuelve a
   `attended`/`scheduled` según fecha.
8. El **motivo** aparece en el tooltip del día y en `recovery_credits.note`.
9. Vigencia del crédito = `fecha_falta + 30`; `created_at` = día de creación.
10. Migración: días `vacation` existentes se ven como "Falta justificada (no cobrable)" y
    siguen sin cobrarse; el balance de recupero no cambia.
