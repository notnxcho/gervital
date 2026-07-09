# Motivo de falta con tooltip en calendario

**Fecha:** 2026-07-09
**Estado:** Aprobado

## Objetivo

Permitir registrar un motivo de texto libre opcional al marcar una falta (justificada
o no justificada) y mostrarlo en un tooltip al hacer hover sobre el día en el
calendario de asistencia del cliente.

## Scope

- Modal de registro de falta (`AbsenceModal` en `ClientDetail.jsx`)
- Vista de calendario del cliente (`ClientDetail.jsx`)
- RPC `mark_day_absent` + servicio `markDayAbsent`

**Fuera de scope:** lógica de crédito de recupero, facturación.

## Estado actual (infra ya existente)

- `attendance_records.notes` (TEXT) ya existe (migración 001).
- `attendance_view` ya expone `notes` (migración 009).
- `getClientAttendance` ya devuelve `notes` por registro.
- El RPC `mark_day_absent` **no** acepta ni escribe `notes` hoy.

## Cambios

### 1. Backend — nueva migración

`CREATE OR REPLACE FUNCTION mark_day_absent(...)` agregando un parámetro
`p_notes text DEFAULT NULL` **al final** de la firma (para no romper llamadas
posicionales existentes). En el `INSERT ... ON CONFLICT` de `attendance_records`:

- `INSERT`: escribir `notes = NULLIF(TRIM(p_notes), '')`.
- `DO UPDATE`: setear `notes = NULLIF(TRIM(EXCLUDED.notes), '')` para que reescribir
  una falta actualice el motivo.

El resto de la función (crédito de recupero para justificadas) queda idéntico.

**Gotcha:** agregar un parámetro con default crea una NUEVA sobrecarga, no reemplaza
la firma vieja de 4 params → "function is not unique". Hay que `DROP FUNCTION` la
firma anterior `mark_day_absent(uuid, date, boolean, text)` antes de recrear con la
nueva. Verificar la firma exacta actual antes de dropear.

### 2. Servicio

`markDayAbsent(clientId, date, isJustified, userName, notes)`:
- Nuevo 5º parámetro `notes`.
- Pasar `p_notes: notes ?? null` en el `supabase.rpc('mark_day_absent', {...})`.

### 3. AbsenceModal — flujo seleccionar → confirmar

Reemplazar el submit instantáneo por selección + confirmación.

Estado interno:
- `selected`: `null | true | false` (tipo de falta elegido)
- `reason`: `string`

UI:
- Dos cards ("Justificada" / "No justificada") ahora **seleccionables**: al hacer clic
  quedan resaltadas (borde/fondo del color correspondiente + check), sin submit.
- Debajo, un `textarea` siempre visible: label "Motivo (opcional)", placeholder
  `Motivo de la falta...`.
- Botón **"Confirmar falta"** deshabilitado hasta que `selected !== null`; al confirmar
  llama `onConfirm(selected, reason.trim() || null)` con estado `submitting`.
- Reset de `selected`/`reason` al cerrar/abrir el modal.

`onConfirm` en `ClientDetail`:
```
onConfirm={(isJustified, notes) =>
  withProcessing(() => markDayAbsent(client.id, selectedDate, isJustified, user?.name, notes))
}
```

### 4. Tooltip en calendario

- `getDayStatus(day)` devuelve además `notes: rec?.notes ?? null`.
- `getDayTooltip(status, isJustified, notes)`: para `absent` devuelve el tipo
  (`Falta justificada (+1 recupero)` / `Falta no justificada`); si hay `notes`,
  incluir el motivo como segunda línea.
- El tooltip custom (`<span>`): renderizar tipo (negrita) + motivo (línea nueva).
  Reemplazar `whitespace-nowrap` por `max-w-[200px] whitespace-normal` cuando hay
  motivo, para que el texto largo envuelva.
- `title=` nativo (fallback): `tipo + '\n' + motivo`.
- Pasar `notes` en el destructuring de `getDayStatus` dentro del render y del
  `handleDayClick`/`selectedRecord` si hace falta para consistencia (el undo no lo usa,
  pero mantener el shape).

## Verificación

- Marcar falta justificada con motivo → tooltip muestra tipo + motivo; DB `notes` set.
- Marcar falta no justificada sin motivo → tooltip solo tipo; DB `notes` NULL.
- Reescribir una falta con distinto motivo → se actualiza.
- Crédito de recupero sigue funcionando igual (justificada +1, undo -1).
