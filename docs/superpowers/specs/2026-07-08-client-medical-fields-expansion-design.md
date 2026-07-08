# Ampliación de campos de la ficha de cliente — Diseño

**Fecha:** 2026-07-08
**Estado:** Aprobado

## Objetivo

Ampliar la ficha de cliente con nuevos campos (todos opcionales) en el tab de
datos personales/contacto y, sobre todo, en el tab de información médica.
Reestructurar la información médica en cinco secciones y modelar de forma
relacional los grupos repetidos (medicamentos, diagnósticos) y los antecedentes.

Algunos campos nuevos **reemplazan** campos actuales; los datos de los campos
eliminados que no tengan destino se **pierden de forma irreversible** (decisión
del usuario).

## Enfoque elegido: A (normalizado)

Tablas relacionales por cliente (patrón `emergency_contacts`), threadeadas por
`create_client_full` / `update_client_full` pasando arrays como jsonb. Ventaja:
consultable (ej. "clientes con antecedente de caídas") y consistente con el repo.

## Modelo de datos

### Nuevas tablas (RLS espejando `medical_info`/`emergency_contacts`: `is_authenticated()` en SELECT/INSERT/UPDATE/DELETE)

**`client_medications`** — Tratamiento farmacológico (1:N)
- `id` uuid PK, `client_id` uuid FK → clients(id) ON DELETE CASCADE
- `name` text, `schedule` text, `dose` text, `indicated_for` text
- `position` int, `created_at` timestamptz

**`client_diagnoses`** — Diagnóstico (1:N)
- `id` uuid PK, `client_id` uuid FK ON DELETE CASCADE
- `diagnosis_type` text CHECK IN (`sin`, `declive_cognitivo`, `deterioro_cognitivo`, `demencia`)
- `behavior_disorder` text
- `position` int, `created_at` timestamptz

**`client_medical_history`** — Antecedentes (1:N)
- `id` uuid PK, `client_id` uuid FK ON DELETE CASCADE
- `condition` text CHECK sobre lista fija de 17
- `comment` text (opcional)
- `created_at` timestamptz
- `UNIQUE(client_id, condition)`
- **Semántica: existe fila ⟺ antecedente presente** (checkbox marcado). Sin
  columna `present`. Guardado con delete+reinsert.

Lista de 17 condiciones (CHECK):
`diabetes`, `celiaquia`, `hipertension`, `intolerancia_lactosa`, `dislipidemia`,
`cardiovascular`, `acv`, `demencia`, `cancer`, `caidas`, `fracturas`, `cirugia`,
`hospitalizacion`, `tuberculosis`, `hepatitis`, `alergias`, `restriccion_alimenticia`.

### Columnas nuevas en `medical_info` (todas nullable)
- Servicio de salud: `health_emergency_service`, `health_provider`, `health_notes`
- Notas de sección: `medication_notes`, `history_notes`
- Historia de vida: `education_level`, `occupation`, `significant_interests`,
  `significant_bonds`, `music_taste`, `favorite_foods`,
  `character` (CHECK IN (`introvertido`, `extrovertido`)),
  `personal_resources`, `vulnerabilities`

### Columnas nuevas en `clients` (todas nullable)
- `marital_status` text CHECK IN (`soltero`, `viudo`, `casado`, `divorciado`, `concubinato`)
- `residence_type` text CHECK IN (`residencial`, `propio`, `familiar`, `otro`)
- `lives_with` text

Todos los CHECK permiten NULL.

**Redundancia conocida (aceptada):** "con quién vive" existe como `lives_with`
(corto/estructurado, en Domicilio) y dentro del textarea `significant_bonds`
(narrativo, en Historia de vida). Se mantienen ambos.

## Migración de datos (destructiva) — dentro de la misma migración, antes de dropear

1. Flags → antecedentes: por cada flag `true`, insertar fila en
   `client_medical_history` (`is_diabetic`→`diabetes`, `is_celiac`→`celiaquia`,
   `is_hypertensive`→`hipertension`, `is_lactose_intolerant`→`intolerancia_lactosa`),
   sin comentario.
2. `dietary_restrictions` con texto → fila `condition='restriccion_alimenticia'`,
   `comment = ese texto`.
3. `medication` con texto → fila en `client_medications`
   (`name`=medication, `schedule`=medication_schedule).

Luego `DROP COLUMN` en `medical_info`:
- `medical_restrictions`, `mobility_restrictions`, `notes` → **se pierden** (confirmado)
- `dietary_restrictions`, `medication`, `medication_schedule` → migrados, luego drop
- `is_diabetic`, `is_celiac`, `is_hypertensive`, `is_lactose_intolerant` → migrados, luego drop

## Backend

Migración **`047`**: crea tablas + RLS, agrega columnas, migra datos, dropea
columnas, recrea vista + RPCs.

### `clients_full` view (recrear)
- Quitar del `medicalInfo` jsonb: `dietaryRestrictions`, `medicalRestrictions`,
  `mobilityRestrictions`, `medication`, `medicationSchedule`, `notes`,
  `isDiabetic`, `isCeliac`, `isHypertensive`, `isLactoseIntolerant`.
- Agregar al `medicalInfo` jsonb: `healthEmergencyService`, `healthProvider`,
  `healthNotes`, `medicationNotes`, `historyNotes`, `educationLevel`,
  `occupation`, `significantInterests`, `significantBonds`, `musicTaste`,
  `favoriteFoods`, `character`, `personalResources`, `vulnerabilities`.
- Agregar a nivel cliente: `maritalStatus`, `residenceType`, `livesWith`.
- Agregar 3 arrays (jsonb_agg ORDER BY position): `medications`
  (`name`/`schedule`/`dose`/`indicatedFor`), `diagnoses`
  (`diagnosisType`/`behaviorDisorder`), `medicalHistory` (`condition`/`comment`).

### RPCs `create_client_full` / `update_client_full`
- `DROP` de las firmas actuales (evitar overload accumulation), recrear.
- Quitar params: `p_med_dietary`, `p_med_medical`, `p_med_mobility`,
  `p_med_medication`, `p_med_medication_schedule`, `p_med_notes`,
  `p_med_is_diabetic`, `p_med_is_celiac`, `p_med_is_hypertensive`,
  `p_med_is_lactose_intolerant`.
- Agregar params: `p_marital_status`, `p_residence_type`, `p_lives_with`,
  `p_health_emergency_service`, `p_health_provider`, `p_health_notes`,
  `p_medication_notes`, `p_history_notes`, `p_education_level`, `p_occupation`,
  `p_significant_interests`, `p_significant_bonds`, `p_music_taste`,
  `p_favorite_foods`, `p_character`, `p_personal_resources`, `p_vulnerabilities`,
  y 3 jsonb: `p_medications`, `p_diagnoses`, `p_medical_history`.
- Arrays: insert en create; delete+reinsert en update cuando el jsonb IS NOT NULL
  (igual que `p_emergency_contacts`).
- Texto: patrón COALESCE existente. El frontend manda `''` para vaciar (funciona,
  `''` no es NULL → sobreescribe).

### `clientTransformers.js`
Mapear los nuevos campos en las 3 funciones (`transformClientToDb`,
`transformClientFromDb`, `transformUpdateToDb`); quitar los viejos.

## UI

### `AddClient.jsx` (wizard)
- **Paso 1 (Datos personales y contacto)**: `Select` estado civil, `Select`
  tipo de domicilio, `Input` con quién vive.
- **Paso 3 (Información médica)**: reestructurar en 5 secciones con subtítulos:
  1. Servicio de salud (emergencia, prestador, notas)
  2. Tratamiento farmacológico (lista editable de medicamentos: nombre, horario,
     dosis, indicado para; add/remove filas + notas)
  3. Antecedentes (17 checkboxes; al marcar aparece input de comentario + notas)
  4. Diagnóstico (lista editable: select tipo + input trastorno de comportamiento)
  5. Historia de vida (9 campos: inputs/textareas + select carácter)

### `ClientDetail.jsx`
- Tab **General**: estado civil, domicilio, con quién vive (view + edit).
- Tab **Información Médica**: reescribir view y edit con las 5 secciones (hoy
  muestra campos viejos que dejan de existir).
- Formulario de edición: mismo layout que el wizard.

### Componentes repetidos
Medicamentos y diagnósticos: render helper con estado array local
(add/remove/update row), serializado a jsonb al guardar. Compartir entre
`AddClient` y `ClientDetail` extrayéndolo a un módulo si no queda muy acoplado;
si se complica, duplicar mínimamente.

### Tailwind
Recompilar tras cambios de estilos:
`npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css`

## Fuera de alcance
- Facturación / precios (sin cambios).
- Búsqueda/filtros por antecedentes (posible follow-up dado que ahora es consultable).
