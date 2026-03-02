# Documentación del Proyecto - Plataforma de Gestión de Club de Día

## Micro Brief

**Plataforma de gestión para un club de día para personas mayores que asisten un día determinado según su plan.**

### Función Principal
La función principal del sitio web es registrar si las personas que debían asistir acudieron y registrar a los usuarios que faltan para que, al final del mes, al emitir la factura, reciban un descuento.

---

## Planes del Servicio

**Estado:** ✅ **DEFINIDO**

El servicio ofrece **4 planes base** con **2 opciones de horario** cada uno, resultando en **8 combinaciones posibles** con precios asociados:

### Planes Base (Frecuencia):
1. **1 vez por semana**
2. **2 veces por semana**
3. **3 veces por semana**
4. **4 veces por semana**

### Opciones de Horario:
- **Medio día (mañana)**
- **Medio día (tarde)**
- **Día completo**

**Total: 4 planes × 2 horarios = 8 combinaciones de planes con precios**

### Características de los Planes:
- Cada combinación tiene un **precio asociado** único
- Al momento del **alta del cliente**, se predefine:
  - Qué **día(s) de la semana** va a asistir (según su plan)
  - Qué **horario** va a cumplir (mañana, tarde, o día completo)
- Esta información queda registrada en la ficha del cliente y se usa para:
  - Calcular las asistencias esperadas
  - Generar facturación mensual
  - Mostrar en el calendario de asistencia

### Plan con o sin Transporte:
- Cada plan puede tener la opción de **incluir transporte** o no
- Esto afecta el precio del plan

**Preguntas pendientes:**
- ¿Cuáles son los precios específicos de cada combinación?
- ¿El transporte tiene un precio adicional fijo o varía según el plan?
- ¿Se puede cambiar el plan de un cliente después del alta?
- ¿Se puede cambiar los días/horarios asignados después del alta?

---

## Arquitectura del Sistema

### Módulos Identificados

#### 1. Login (Módulo de Autenticación)
**Estado:** ✅ **DEFINIDO**

**Acceso:** Punto de entrada principal del sistema.

**Características:**
- **Solo Login:** No existe pantalla de registro público
- Los usuarios se crean desde el módulo "Accesos" (solo accesible para usuarios autenticados con permisos)
- Autenticación mediante usuario y contraseña

**Flujos desde Login:**
- Login → Homescreen (después de autenticación exitosa)
- Login → Transporte
- Login → Proveedores y gastos

**Preguntas pendientes:**
- ¿Se requiere recuperación de contraseña?
- ¿Hay requisitos de seguridad específicos? (longitud mínima, complejidad, etc.)
- ¿Hay bloqueo de cuenta después de intentos fallidos?
- ¿Se requiere autenticación de dos factores?

---

#### 2. Homescreen (Pantalla Principal / Dashboard)
**Estado:** ✅ **PARCIALMENTE DEFINIDO**

**Funcionalidades identificadas:**
- Overview de turnos
- Faltantes hoy (lista de personas que faltaron hoy)
- Recuperan hoy (lista de personas que están usando un día de recupero hoy)
- Transportes hoy (resumen de transportes del día)

**Flujos:**
- Homescreen → Detalle de cliente

**Preguntas pendientes:**
- ¿Cómo se visualiza el "overview de turnos"? (¿tabla, cards, calendario?)
- ¿Qué información específica muestra cada sección?
- ¿Hay filtros o búsquedas en el dashboard?
- ¿Se requiere exportación de datos o reportes?
- ¿Hay notificaciones o alertas en el dashboard?

---

#### 3. Clientes (Lista de Clientes)
**Estado:** ⚠️ **INFORMACIÓN INCOMPLETA**

**Funcionalidad identificada:**
- Módulo que lista todos los clientes
- Acceso a: Clientes → Detalle de cliente

**Preguntas pendientes:**
- ¿Cómo se visualiza la lista de clientes? (hay una imagen de referencia mencionada pero no disponible)
- ¿Qué información se muestra en cada item de la lista? (nombre, plan, estado, etc.)
- ¿Hay búsqueda/filtros en la lista?
- ¿Se puede ordenar por diferentes criterios?
- ¿Hay paginación o scroll infinito?
- ¿Se pueden realizar acciones masivas desde la lista?

---

#### 4. Detalle de Cliente
**Estado:** ✅ **BIEN DEFINIDO**

**Funcionalidades identificadas:**
- **Calendario de asistencia:** Bindado a facturación y cobro
  - Muestra el historial de asistencia del cliente
  - Vinculado directamente con el sistema de facturación
- **Contador de recuperación:** Muestra días de recupero disponibles
- **Preferencias de asistencia:** Configuración de días/horarios preferidos del cliente (predefinidos al alta)

**Flujos:**
- Detalle de cliente → Marcar falta
- Descontar día de recupero → Detalle de cliente

### Campos del Cliente (Alta Usuario)

**Estado:** ✅ **DEFINIDO**

#### Información de Plan y Asistencia:
- **Fecha de ingreso:** Fecha en que el cliente se registró/comenzó el servicio
- **Plan (con o sin transporte):** Plan seleccionado con indicación si incluye transporte
- **Días que asiste y horario:** 
  - Días de la semana predefinidos según el plan
  - Horario: medio día mañana, medio día tarde, o día completo
  - Esta información se establece al alta y queda en la ficha del cliente
- **Cálculo automático de pago en primer mes:** 
  - Sistema que calcula automáticamente el pago proporcional del primer mes
  - Considera la fecha de ingreso y el plan seleccionado

#### Datos Personales:
- **Nombre y apellido:** Nombre completo del cliente
- **Correo para envío factura:** Email donde se enviarán las facturas mensuales

#### Contacto de Emergencia:
- **Nombre del familiar:** Nombre de la persona de contacto de emergencia
- **Vínculo:** Relación con el cliente (ej: hijo, hija, cónyuge, etc.)

#### Dirección:
- **Dirección exacta:** Dirección completa del domicilio
- **Observaciones de acceso:** Notas sobre cómo acceder al domicilio
- **Portería:** Información sobre portería o conserjería
- **Timbre:** Información sobre el timbre o acceso

#### Información Médica y Restricciones:
- **Restricciones alimentarias:** Alergias o restricciones dietéticas
- **Restricciones médicas:** Condiciones médicas relevantes
- **Restricciones de movilidad:** Limitaciones de movilidad u otras restricciones
- **Medicación:** 
  - **Cuál:** Nombre de la medicación
  - **Horario:** Horario o frecuencia de administración

**Preguntas pendientes:**
- ¿Se puede editar información del cliente después del alta?
- ¿Cómo se visualiza el calendario? (vista mensual, semanal, lista de eventos)
- ¿Se pueden ver estadísticas del cliente? (asistencias totales, faltas, etc.)
- ¿Hay campos adicionales que no están en la lista?
- ¿Se requiere validación específica para algún campo? (ej: formato de email, teléfono, etc.)

---

#### 5. Marcar Falta (Proceso de Registro de Ausencia)
**Estado:** ✅ **BIEN DEFINIDO**

**Funcionalidad:**
Proceso para registrar cuando un cliente no asistió en su día programado.

**Flujo del proceso:**
1. Desde "Detalle de cliente" → "Marcar falta"
2. Se marca como falta en el calendario
3. **Importante:** La falta se computa para cobrarse a fin de mes (se factura igual)
4. **Decisión:** ¿La falta está justificada?
   - Si está justificada:
     - Se suma un día de recupero al contador
     - NO se computa como cobrable (no se factura)
   - Si NO está justificada:
     - Se computa como cobrable (se factura)
5. Si hay días de recupero disponibles → "Descontar día de recupero"

**Preguntas pendientes:**
- ¿Cómo se gestiona la justificación? (¿hay un campo de texto, opciones predefinidas, requiere aprobación?)
- ¿Quién puede marcar justificadas las faltas? (¿cualquier usuario o solo administradores?)
- ¿Se puede deshacer una falta marcada?
- ¿Hay un límite de tiempo para marcar una falta? (¿se puede marcar retroactivamente?)
- ¿Se requiere algún comentario o nota al marcar la falta?

---

#### 6. Descontar Día de Recupero (Proceso de Uso de Día de Recupero)
**Estado:** ✅ **BIEN DEFINIDO**

**Funcionalidad:**
Proceso para usar un día de recupero disponible.

**Flujo del proceso:**
1. Desde el proceso de "Marcar falta" (cuando hay días de recupero disponibles)
2. Se resta un día del contador de recuperación
3. Se marca asistencia en la fecha correspondiente
4. Retorna a "Detalle de cliente"

**Preguntas pendientes:**
- ¿Se puede descontar un día de recupero sin haber marcado una falta previamente?
- ¿Hay un límite de días de recupero que se pueden acumular?
- ¿Los días de recupero tienen fecha de vencimiento?
- ¿Se puede elegir en qué fecha aplicar el día de recupero o siempre es en la fecha de la falta?

---

#### 7. Transporte (Módulo de Transporte)
**Estado:** ⚠️ **INFORMACIÓN FALTANTE - CRÍTICO**

**Acceso:** Login → Transporte

**Mencionado en Homescreen:** "Transportes hoy" aparece como una sección del dashboard.

**Preguntas pendientes:**
- ¿Cuál es el propósito del módulo de transporte?
- ¿Se registra qué clientes usan transporte?
- ¿Se gestionan rutas de transporte?
- ¿Se registran horarios de recogida/llegada?
- ¿Hay un registro de vehículos o conductores?
- ¿Se factura el transporte por separado o está incluido en el plan?
- ¿Cómo se relaciona con el sistema de asistencia?
- ¿Qué información se muestra en "Transportes hoy" del Homescreen?

---

#### 8. Proveedores y Gastos (Módulo de Proveedores y Gastos)
**Estado:** ⚠️ **INFORMACIÓN FALTANTE - CRÍTICO**

**Acceso:** Login → Proveedores y gastos

**Permisos:**
- **Superadmin:** Acceso completo
- **Admin:** ❌ **SIN ACCESO** (solo superadmin puede acceder)

**Preguntas pendientes:**
- ¿Cuál es el propósito de este módulo?
- ¿Se registran proveedores del club?
- ¿Se gestionan gastos operativos?
- ¿Se registran facturas de proveedores?
- ¿Hay categorización de gastos?
- ¿Se requiere generar reportes de gastos?
- ¿Hay presupuestos o límites de gastos?
- ¿Cómo se relaciona con el resto del sistema?

---

#### 9. Accesos (Módulo de Gestión de Usuarios y Permisos)
**Estado:** ✅ **DEFINIDO**

**Acceso:** Disponible después del login (accesible según permisos)

**Funcionalidad:**
- Controla los usuarios y permisos del sistema
- Gestión de usuarios del sistema (no clientes)
- Desde aquí se agregan nuevos usuarios del sistema
- **No existe pantalla de registro público** - todos los usuarios se crean desde este módulo

**Roles del Sistema:**

1. **Superadmin:**
   - ✅ Acceso a **todo** el sistema
   - ✅ Puede acceder a todos los módulos
   - ✅ Puede gestionar usuarios en el módulo Accesos
   - ✅ Puede acceder a Proveedores y gastos
   - ✅ Puede acceder a Estadísticas

2. **Admin:**
   - ✅ Acceso a la mayoría de módulos
   - ✅ Puede gestionar clientes
   - ✅ Puede gestionar asistencias y faltas
   - ✅ Puede acceder a Transporte
   - ✅ Puede acceder a Homescreen
   - ❌ **NO puede acceder a:** Registro de proveedores (módulo Proveedores y gastos)
   - ❌ **NO puede acceder a:** Pantalla de Estadísticas

**Preguntas pendientes:**
- ¿Qué información se muestra en la lista de usuarios? (nombre, email, rol, fecha creación, etc.)
- ¿Se puede editar información de usuarios existentes?
- ¿Se puede cambiar el rol de un usuario?
- ¿Se puede desactivar/eliminar usuarios?
- ¿Se puede restablecer contraseñas desde este módulo?
- ¿Hay registro de actividad/auditoría de usuarios?
- ¿Quién puede acceder al módulo de Accesos? (¿solo superadmin o también admin?)

---

#### 10. Estadísticas (Módulo de Estadísticas)
**Estado:** ⚠️ **INFORMACIÓN INCOMPLETA**

**Acceso:** Disponible después del login

**Permisos:**
- **Superadmin:** ✅ Acceso completo
- **Admin:** ❌ **SIN ACCESO** (solo superadmin puede acceder)

**Preguntas pendientes:**
- ¿Qué tipo de estadísticas se muestran?
- ¿Hay gráficos o reportes visuales?
- ¿Qué métricas se incluyen? (asistencias, faltas, facturación, etc.)
- ¿Se pueden filtrar por fechas o períodos?
- ¿Se pueden exportar las estadísticas?
- ¿Hay comparativas entre períodos?

---

## Sistema de Roles y Permisos

**Estado:** ✅ **DEFINIDO**

### Roles Disponibles

#### 1. Superadmin
**Permisos completos:**
- ✅ Acceso a todos los módulos del sistema
- ✅ Gestión de usuarios (módulo Accesos)
- ✅ Gestión de clientes
- ✅ Gestión de asistencias y faltas
- ✅ Acceso a Transporte
- ✅ Acceso a Proveedores y gastos
- ✅ Acceso a Estadísticas
- ✅ Acceso a Homescreen

#### 2. Admin
**Permisos limitados:**
- ✅ Gestión de clientes
- ✅ Gestión de asistencias y faltas
- ✅ Acceso a Transporte
- ✅ Acceso a Homescreen
- ❌ **NO puede acceder a:** Módulo de Proveedores y gastos
- ❌ **NO puede acceder a:** Pantalla de Estadísticas

**Preguntas pendientes:**
- ¿El admin puede gestionar usuarios en el módulo Accesos? (¿puede crear otros admins o solo superadmin?)
- ¿Hay más roles planificados para el futuro?
- ¿Se pueden crear roles personalizados con permisos específicos?

---

## Flujos de Trabajo Principales

### Flujo de Registro de Asistencia y Facturación

1. **Cliente tiene plan de asistencia** → Días programados según su plan
2. **Día programado:**
   - Si **asiste** → Se marca asistencia en calendario → Se factura a fin de mes
   - Si **NO asiste** → Se marca falta
3. **Marcar falta:**
   - Si **NO justificada** → Se factura igual a fin de mes
   - Si **justificada** → NO se factura + Se suma 1 día de recupero
4. **Uso de día de recupero:**
   - Cliente puede usar día de recupero disponible
   - Se resta del contador
   - Se marca como asistencia en la fecha elegida
   - NO se factura (ya que es recupero)

### Flujo de Facturación Mensual

**Estado:** ✅ **PARCIALMENTE DEFINIDO**

**Información definida:**
- El sistema tiene **8 combinaciones de planes** con precios asociados
- Cada cliente tiene un **plan predefinido** con días y horarios asignados
- El **primer mes** se calcula automáticamente de forma proporcional según la fecha de ingreso
- La facturación considera:
  - Días asistidos (se facturan)
  - Faltas **NO justificadas** (se facturan igual)
  - Faltas **justificadas** (NO se facturan, generan día de recupero)
  - Días de recupero usados (NO se facturan)

**Preguntas pendientes:**
- ¿Cómo se genera la factura mensual? (¿automático o manual?)
- ¿Qué información detallada incluye la factura? (desglose de días, faltas, recuperos, etc.)
- ¿Se puede editar la factura antes de emitirla?
- ¿Se puede facturar parcialmente un mes? (¿qué pasa si un cliente se da de baja a mitad de mes?)
- ¿Hay sistema de pagos o solo facturación?
- ¿Cómo se manejan los meses con diferentes cantidades de días? (¿se prorratea?)
- ¿Se envían las facturas automáticamente al correo registrado?

---

## Stack Tecnológico Actual

**Frontend:**
- React 19.2.3
- React DOM 19.2.3
- Tailwind CSS 4.1.18
- Iconoir React (iconos)
- React Scripts 5.0.1

**Preguntas pendientes sobre tecnología:**
- ¿Se requiere backend? (¿qué tecnología?)
- ¿Se requiere base de datos? (¿qué tipo? SQL, NoSQL, etc.)
- ¿Se requiere hosting/despliegue? (¿dónde?)
- ¿Hay requisitos de accesibilidad?
- ¿Hay requisitos de responsive design?
- ¿Se requiere modo offline?

---

## Diseño y UX

**Estado:** ⚠️ **INFORMACIÓN PARCIAL**

**Mencionado:**
- Hay una imagen de referencia para la lista de clientes (no disponible en la documentación actual)

**Preguntas pendientes:**
- ¿Hay un sistema de diseño o guía de estilo?
- ¿Hay colores/branding específicos?
- ¿Hay requisitos de accesibilidad? (WCAG, etc.)
- ¿Cómo debe verse en móvil/tablet?
- ¿Hay usuarios con diferentes niveles de conocimiento tecnológico?

---

## Resumen de Información Faltante

### Crítico (Módulos sin definición):
1. **Módulo de Transporte** - Sin definición de funcionalidad
2. **Módulo de Proveedores y Gastos** - Sin definición de funcionalidad (solo superadmin)

### Importante (Detalles de implementación):
3. **Sistema de Facturación** - Proceso completo de generación y envío de facturas
4. **Lista de Clientes** - Diseño y funcionalidades específicas
5. **Gestión de Justificaciones** - Cómo se manejan las justificaciones de faltas
6. **Precios de Planes** - Valores específicos de las 8 combinaciones de planes
7. **Módulo de Estadísticas** - Qué estadísticas y reportes se incluyen

### Complementario (Mejoras y detalles):
8. **Stack Backend** - Tecnologías del servidor
9. **Base de Datos** - Estructura y tipo
10. **Diseño Visual** - Guías de estilo y referencias
11. **Homescreen** - Layout y visualización detallada

---

## Próximos Pasos

1. Responder las preguntas marcadas como "Preguntas pendientes"
2. Proporcionar la imagen de referencia de la lista de clientes
3. Definir los módulos faltantes (Transporte y Proveedores y gastos)
4. Especificar el stack tecnológico completo (backend, base de datos, etc.)
5. Definir el sistema de facturación completo
6. Establecer guías de diseño y UX

---

## Notas Adicionales

- El proyecto actualmente tiene una estructura básica de React con Tailwind CSS
- Se usa Iconoir para iconos
- No hay backend implementado aún
- No hay sistema de autenticación implementado aún
- No hay base de datos configurada aún
