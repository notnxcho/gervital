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
