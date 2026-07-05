# Estandarización de planillas de clientes → formato único

Pasos:
1. Copiá el **prompt** de abajo y pegáselo a Claude junto con las planillas de Excel.
2. Claude devuelve un CSV unificado (una fila por cliente) + lista de filas a revisar.
3. Pasame ese CSV y yo creo los clientes con el mismo flujo que usamos para Alicia.

---

## 📋 Prompt para copiar y pegar

```
Tengo varias planillas de Excel con datos de clientes de un club de día para
adultos mayores. La información de cada cliente está desperdigada entre varias
hojas/archivos. Quiero que las UNIFIQUES en una sola tabla, UNA FILA POR CLIENTE,
con exactamente estas columnas (en este orden):

first_name, last_name, document_type, document_number, email, phone, birth_date,
cognitive_level, start_date, transfer_responsible, plan_frequency, plan_schedule,
plan_has_transport, plan_assigned_days, address_street, address_doorbell,
address_access_notes, address_concierge, address_distance_range,
emergency1_name, emergency1_relationship, emergency1_phone,
emergency2_name, emergency2_relationship, emergency2_phone,
med_dietary, med_medical, med_mobility, med_medication, med_medication_schedule,
med_notes, med_is_diabetic, med_is_celiac, med_is_hypertensive,
med_is_lactose_intolerant, revisar

VALORES PERMITIDOS (usar EXACTAMENTE estos, en inglés/minúscula donde aplique):
- document_type: ci | rut | pasaporte | dni | otro   (default: ci)
- cognitive_level: A | B | C | D
- plan_schedule: morning | afternoon | full_day      (mañana=morning, tarde=afternoon, día completo=full_day)
- plan_frequency: 1 | 2 | 3 | 4 | 5
- plan_assigned_days: lista separada por coma con: monday, tuesday, wednesday, thursday, friday
  (lunes=monday, martes=tuesday, miércoles=wednesday, jueves=thursday, viernes=friday)
- plan_has_transport / med_is_*: true | false
- address_distance_range: 0_to_2km | 2_to_5km | 5_to_10km  (o vacío si no se sabe)

REGLAS DE NORMALIZACIÓN:
1. NO inventes datos. Si un dato falta en las planillas, dejá la celda VACÍA y
   anotá en la columna "revisar" qué falta.
2. document_number: solo dígitos, sin puntos ni guiones (ej: 1.333.808-6 → 13338086).
3. Fechas siempre en formato YYYY-MM-DD.
4. address_street: SOLO calle y número (geocodable por Google). Si en el origen
   viene apto/unidad/timbre, sacalo de la calle y ponelo en address_doorbell o
   address_access_notes. Asumí que todos son de Montevideo (no agregues ciudad/depto).
5. plan_assigned_days: la cantidad de días debe coincidir con plan_frequency.
   Si no coincide o no están claros, dejalo lo más fiel posible y marcalo en "revisar".
6. emergency1_name + emergency1_phone son obligatorios. Si no hay ningún contacto
   de emergencia, marcalo en "revisar".
7. email en minúscula. Si hay varios, poné el principal.
8. Ante cualquier ambigüedad, duplicado de cliente, o dato contradictorio entre
   planillas, NO decidas vos: anotalo en "revisar".

SALIDA: devolveme la tabla unificada en formato CSV (con header), y una lista
aparte de las filas que tienen algo en "revisar" para que las resuelva a mano.
```

---

## 📐 Referencia: esquema de columnas

| Columna | ¿Requerido? | Valores / tipo | Notas |
|---|---|---|---|
| `first_name` | ✅ | texto | Nombre(s) |
| `last_name` | ✅ | texto | Apellido(s) |
| `document_type` | ✅ | `ci` · `rut` · `pasaporte` · `dni` · `otro` | Por defecto `ci` |
| `document_number` | ✅ (Biller) | solo dígitos | Sin puntos ni guiones, con dígito verificador |
| `email` | ⚠️ recomendado | email | Biller manda el PDF acá. Si no hay, dejar vacío |
| `phone` | – | texto | |
| `birth_date` | – | `YYYY-MM-DD` | |
| `cognitive_level` | – | `A` · `B` · `C` · `D` | A=independiente … D=asistencia alta |
| `start_date` | ✅ | `YYYY-MM-DD` | Fecha de ingreso. Define el mes de inicio del plan |
| `transfer_responsible` | – | texto | Titular para transferencia/pago (como figura en el banco) |
| `plan_frequency` | ✅ | `1` · `2` · `3` · `4` · `5` | Veces por semana (5 = lun a vie) |
| `plan_schedule` | ✅ | `morning` · `afternoon` · `full_day` | |
| `plan_has_transport` | ✅ | `true` · `false` | |
| `plan_assigned_days` | ✅ | lista coma-separada: `monday,tuesday,wednesday,thursday,friday` | Cantidad = `plan_frequency` |
| `address_street` | ✅ (Biller) | texto | SOLO calle + número (geocodable). Sin apto/timbre |
| `address_doorbell` | – | texto | Timbre/apto. Va al domicilio fiscal de Biller como "Timbre X" |
| `address_access_notes` | – | texto | Referencias de acceso |
| `address_concierge` | – | texto | Portería |
| `address_distance_range` | – | `0_to_2km` · `2_to_5km` · `5_to_10km` | Si se conoce; si no, se calcula por geocoding |
| `emergency1_name` | ✅ | texto | Al menos 1 contacto con nombre + teléfono |
| `emergency1_relationship` | – | texto | Ej: Hija, Esposo |
| `emergency1_phone` | ✅ | texto | |
| `emergency2_name` / `_relationship` / `_phone` | – | texto | Contacto adicional (opcional) |
| `med_dietary` | – | texto | Restricciones alimentarias |
| `med_medical` | – | texto | Restricciones médicas |
| `med_mobility` | – | texto | Restricciones de movilidad |
| `med_medication` | – | texto | Medicación |
| `med_medication_schedule` | – | texto | Horario de medicación |
| `med_notes` | – | texto | Notas |
| `med_is_diabetic` / `_is_celiac` / `_is_hypertensive` / `_is_lactose_intolerant` | – | `true` · `false` | Default `false` |
| `revisar` | – | texto | Dudas / datos faltantes / ambigüedades a resolver a mano |
