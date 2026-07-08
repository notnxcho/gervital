# Lessons

## PostgREST embeds: UNIQUE FK → objeto, no array
`client_addresses` tiene `UNIQUE(client_id)`. Cuando una relación embebida tiene
constraint UNIQUE en la FK, PostgREST/supabase-js la detecta como **uno-a-uno** y
la devuelve como **objeto** (`{street: ...}`), NO como array (`[{street: ...}]`).
- Síntoma: `client.client_addresses?.[0]?.street` siempre da `undefined` → guards
  de "no tiene dirección" disparan falsos positivos aunque el dato exista.
- Regla: al leer un embed, no asumir array. Normalizar:
  `const row = Array.isArray(a) ? a[0] : a`. (helper `addrStreet` en `biller/index.ts`)
- Pasó en `sync_client` Y en `emit_invoice` (este último emitía facturas con
  dirección vacía sin avisar). Revisar todos los embeds de tablas con FK única.

## Verificar antes de afirmar "no existe X" en una API externa
Caso Biller: la doc Postman es JS y WebFetch devolvía vacío → casi afirmo "no hay
endpoint de búsqueda" sin evidencia. La forma correcta: leer el JSON crudo de la
colección vía `https://documenter.gw.postman.com/api/collections/<view>/<pubid>`.
Confirmar contra la fuente antes de concluir, sobre todo si el usuario duda.

## La fuente de verdad es la DB/código, no CLAUDE.md ni los specs
Afirmé que frecuencia de plan era 1-4 (sale del data model y "Reglas de precios"
del CLAUDE.md). El usuario sabía que pueden ser 5 días. La realidad: CHECK de
client_plans permite 1-5 y plan_pricing tiene 15 combos (5 freq x 3 horarios).
CLAUDE.md y los specs pueden estar desactualizados. Para constraints/enums/valores
permitidos, verificar SIEMPRE contra el esquema vivo (CHECK constraints, tablas de
catálogo como plan_pricing) antes de documentar o decidir. Corregido CLAUDE.md
(líneas de Client, PlanPricing y Reglas de precios) para no propagar el error.

## Enum "hardcodeado" → dinámico: grepear TODAS las validaciones, no solo el CHECK
Al convertir los motivos de baja (lista fija) en gestionables por DB (tabla
`deactivation_reasons`, mig 044), dropeé el CHECK de `clients.deactivation_reason`
pero se me escapó que el RPC `deactivate_client` (mig 030) validaba el motivo
contra la MISMA lista vieja hardcodeada con `RAISE EXCEPTION 'Invalid deactivation
reason'`. Resultado: la baja con motivos nuevos fallaba con 400 en producción.
- Síntoma: error de dominio ("Invalid X") con código 400, NO el error típico de
  CHECK constraint de Postgres → señal de que hay validación en plpgsql, no en el schema.
- Regla: al migrar un enum/lista a datos dinámicos, grepear el valor en TODO
  `supabase/migrations/`: `CHECK`, `RAISE EXCEPTION`, `NOT IN (...)`, `= ANY`, y
  funciones que lo reciban como parámetro. El review de diff no lo caza si el RPC
  no está en el diff — buscar consumidores fuera del diff explícitamente.
- Fix elegante: validar contra la tabla fuente de verdad
  (`EXISTS (SELECT 1 FROM deactivation_reasons WHERE key = p_reason AND is_active)`),
  no re-hardcodear la lista.
