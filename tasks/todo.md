# Completar creación/vinculación de clientes en Biller

## Contexto
La creación de receptores en Biller está incompleta. Hoy: al crear un cliente con
cédula se dispara `sync_client` fire-and-forget; la EF arma un receptor y hace
`POST /v2/clientes/crear`. Falta: ciudad/departamento en el payload, lógica de
vincular con receptor existente, cédula obligatoria, y feedback al usuario.

## Decisiones validadas con el usuario
- ciudad + departamento = `'Montevideo'` (hardcode para todos)
- cédula obligatoria en el alta de cliente
- alcance completo: payload + vincular-existente + feedback UI

## Tareas

### A. Edge function — payload del receptor
- [x] A1. `lib/comprobante.ts` `buildClientePayload`: ciudad + departamento 'Montevideo'.
- [x] A2. `index.ts` `sync_client`: usa `buildClientePayload` (sin payload duplicado).
- [x] A3. `index.ts` `sync_client`: guard "ya sincronizado" (`alreadySynced`) salvo `force`.
- [x] A4. `index.ts` `sync_client`: guard dirección requerida (422).
- [x] A5. `index.ts` `sync_client`: `detail` con body crudo (500 chars) para diagnóstico.
      Branch final de "vincular existente" PENDIENTE del checkpoint de prueba.

### B. Frontend — cédula obligatoria
- [x] B1. `AddClient.jsx` `validateStep(1)`: `documentNumber` requerido.

### C. Frontend — feedback de sync en el alta
- [x] C1. `AddClient.jsx`: await + alert no bloqueante si falla. Cliente se crea igual.
- [x] C2. `billerService.syncClientToBiller(clientId, force)`.

### D. Frontend — chip de estado explícito
- [x] D1. `ClientDetail.jsx`: botón rojo "Error Biller — reintentar" cuando hay error.

### E. Re-sync al editar datos fiscales
- [x] E1. `AddClient.jsx` (modo edit): re-sync `force:true` tras guardar.
      ⚠️ Depende del checkpoint: si `crear` duplica receptores ante CI repetida,
      hay que gatear esto hasta tener endpoint de update/link.

## Despliegue
- [x] Deploy EF `biller` → versión 8 (verify_jwt intacto).
- [x] Recompilar Tailwind (clases bg-red-* del chip).

## Checkpoint de prueba (usuario)
- [x] BUG encontrado y corregido: `client_addresses` tiene UNIQUE(client_id) →
      PostgREST lo embebe como objeto, `?.[0]?.street` daba undefined → 422 falso.
      Helper `addrStreet()` tolera objeto/array. Mismo bug arreglado en emit_invoice.
      EF desplegada v9. Ver tasks/lessons.md.
- [x] Sync con CI ya existente en Biller (53534462) → `/clientes/crear` devolvió OK
      (cliente 52084, sucursal 58378). NO rompe con documento duplicado → "vincular
      existente" funciona vía `crear`, sin endpoint de búsqueda.
- [x] Verificado en panel Biller: un solo contacto para la CI → `crear` NO duplicó.
      "Vincular existente" 100% resuelto vía `crear`.

## Limitación conocida
- Biller `/clientes/crear` NO tiene campo `telefono` (su web sí, la API no). Se mandan
  todos los demás: CI, nombre, dirección, ciudad, departamento, país, email.
  Pendiente decisión usuario: dejar teléfono afuera vs. confirmar campo con soporte.

## Incógnita pendiente
La doc pública de Biller (Postman, render JS) no expone endpoint de búsqueda/
listado/update de clientes. El comportamiento de `crear` ante documento duplicado
es desconocido → se resuelve con el checkpoint de prueba.
