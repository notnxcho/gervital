# Gervital - Documentación del Proyecto

## Descripción General

**Gervital** es una plataforma de gestión para un club de día para personas mayores. Los clientes asisten según un plan predefinido (días y horarios específicos) y el sistema se encarga de:

- Registrar asistencias y ausencias
- Gestionar días de recupero
- Facturar mensualmente según la asistencia
- Administrar proveedores y gastos
- Gestionar usuarios del sistema

### Objetivo Principal
Controlar la asistencia de los clientes y generar facturación mensual proporcional a los días que efectivamente se cobran, considerando faltas justificadas/injustificadas y días de recupero.

---

## Stack Tecnológico

### Frontend
- **React 19** - Framework principal
- **React Router DOM 7** - Navegación SPA
- **Tailwind CSS 3** - Estilos (compilación manual con `npx tailwindcss`)
- **Iconoir React** - Librería de iconos
- **date-fns** - Manipulación de fechas
- **@dnd-kit** - Drag & drop (Grupos, Transporte)
- **@react-google-maps/api** - Google Maps (Transporte)

### Build Tools
- **Create React App** con **CRACO** para override de configuración
- PostCSS + Autoprefixer

### Backend
- **Supabase** - Backend-as-a-Service (PostgreSQL + Auth)
- **@supabase/supabase-js** - Cliente JavaScript

### Arquitectura de Servicios
```
src/services/
├── supabase/client.js      # Cliente Supabase
├── auth/authService.js     # Autenticación
├── clients/                # CRUD de clientes
├── attendance/             # Asistencia
├── invoices/               # Facturación
├── suppliers/              # Proveedores
├── expenses/               # Gastos
├── pricing/                # Precios de planes
├── users/                  # Usuarios del sistema
└── api.js                  # Facade backward-compatible
```

---

## Modelo de Datos

### User (Usuario del sistema)
```javascript
{
  id: string,
  name: string,
  email: string,
  role: 'admin' | 'superadmin',
  createdAt: string // YYYY-MM-DD
}
```

### Client (Cliente/Asistente del club)
```javascript
{
  id: string,
  firstName: string,
  lastName: string,
  email: string,              // Para envío de facturas
  phone: string,
  birthDate: string,          // YYYY-MM-DD
  cognitiveLevel: 'A' | 'B' | 'C' | 'D',  // Tier cognitivo
  startDate: string,          // Fecha de ingreso
  
  plan: {
    frequency: 1 | 2 | 3 | 4,           // Veces por semana
    schedule: 'morning' | 'afternoon' | 'full_day',
    hasTransport: boolean,
    assignedDays: ['monday', 'tuesday', ...]  // Días predefinidos
  },
  
  emergencyContact: {
    name: string,
    relationship: string,
    phone: string
  },
  
  address: {
    street: string,
    accessNotes: string,
    doorbell: string,
    concierge: string
  },
  
  medicalInfo: {
    dietaryRestrictions: string,
    medicalRestrictions: string,
    mobilityRestrictions: string,
    medication: string,
    medicationSchedule: string,
    notes: string
  },
  
  recoveryDaysAvailable: number,  // Contador de días de recupero
  createdAt: string
}
```

### Tier Cognitivo
- **A**: Independiente
- **B**: Asistencia leve
- **C**: Asistencia moderada
- **D**: Asistencia alta

### MonthlyAttendance (Asistencia mensual planificada)
```javascript
{
  clientId: string,
  year: number,
  month: number,              // 0-11
  plannedDays: [              // Días planificados para el mes
    {
      date: string,           // YYYY-MM-DD
      shift: 'morning' | 'afternoon' | 'full_day'
    }
  ],
  createdAt: string,
  updatedAt: string
}
```

### AttendanceRecord (Registro de asistencia diaria)
```javascript
{
  clientId: string,
  date: string,               // YYYY-MM-DD
  shift: 'morning' | 'afternoon' | 'full_day',
  status: 'attended' | 'unjustified_absence' | 'justified_recovered' | 
          'justified_not_recovered' | 'recovered' | 'scheduled',
  notes: string
}
```

### Estados de Asistencia
| Estado | Descripción | ¿Se cobra? | Efecto en recupero |
|--------|-------------|------------|-------------------|
| `attended` | Asistió normalmente | ✅ Sí | - |
| `unjustified_absence` | Falta no justificada | ✅ Sí | - |
| `justified_recovered` | Falta justificada con recupero | ✅ Sí | +1 día recupero |
| `justified_not_recovered` | Falta justificada sin recupero | ❌ No | - |
| `recovered` | Usó un día de recupero | ✅ Sí | -1 día recupero |
| `scheduled` | Día programado (futuro) | - | - |

### MonthlyInvoice (Factura mensual)
```javascript
{
  clientId: string,
  year: number,
  month: number,              // 0-11
  
  // Días y montos
  plannedDays: number,        // Días planificados para el mes
  chargeableDays: number,     // Días que se cobran
  potentialAmount: number,    // Monto si asiste todos los días
  chargeableAmount: number,   // Monto real a cobrar
  
  // Estado de facturación (independiente del pago)
  invoiceStatus: 'pending' | 'invoiced',
  invoicedAt: string | null,
  invoicedBy: string | null,
  invoiceNumber: string | null,
  invoiceUrl: string | null,
  
  // Estado de pago (independiente de facturación)
  paymentStatus: 'pending' | 'paid' | 'overdue',
  paymentDueDate: string,     // Vencimiento: día 10 del mes
  paidAt: string | null,
  paidAmount: number | null,
  paymentMethod: string | null,
  paymentNotes: string | null,
  
  createdAt: string,
  updatedAt: string
}
```

### Supplier (Proveedor)
```javascript
{
  id: string,
  name: string,
  category: string,           // Alimentación, Limpieza, Transporte, etc.
  contact: string,
  phone: string,
  email: string,
  notes: string,
  createdAt: string
}
```

### Expense (Gasto)
```javascript
{
  id: string,
  supplierId: string,
  description: string,
  amount: number,
  type: 'recurring' | 'extraordinary',
  year: number,
  month: number,
  date: string,
  status: 'pending' | 'paid',
  paidAt: string | null,
  notes: string
}
```

### PlanPricing (Precios de planes)
```javascript
{
  frequency: 1 | 2 | 3 | 4,
  schedule: 'morning' | 'afternoon' | 'full_day',
  price: number               // Precio mensual base
}
// Transporte agrega +20% al precio base
```

---

## Sistema de Facturación y Cobro

### Modelo de Cobro Adelantado

1. **Planificación mensual**: A principio de mes (o fin del anterior) se definen los días que el cliente asistirá. Por defecto son los días predefinidos en su plan, pero pueden editarse.

2. **Facturación**: Se realiza a **fin de mes** (o principios del siguiente) con el monto calculado según los días planificados.

3. **Cobro**: Se cobra **por adelantado** con vencimiento el **día 10 de cada mes**.

4. **Estados independientes**:
   - `invoiceStatus`: Si se generó la factura electrónica
   - `paymentStatus`: Si se recibió el pago

### Flujo de Facturación

```
Mes anterior         Mes actual              Próximo mes
    │                    │                       │
    │  [Planificar días] │                       │
    │  [Facturar]        │                       │
    ▼                    │                       │
         ─────────────── 1 ──────────────────────
                         │
                    [Vencimiento día 10]
                         │
         ─────────────── 10 ─────────────────────
                         │
              [Registrar asistencias]
                         │
         ─────────────── 30/31 ──────────────────
                         │
              [Ajustes si corresponde]
```

### Cálculo de Montos

```javascript
// Precio mensual del plan
const monthlyPrice = calculatePlanPrice(frequency, schedule)

// Días planificados en el mes
const plannedDays = getPlannedDaysForMonth(clientId, year, month)

// Días cobrables (excluye justified_not_recovered)
const chargeableDays = plannedDays.filter(d => d.status !== 'justified_not_recovered')

// Monto a cobrar
const chargeableAmount = (chargeableDays.length / plannedDays.length) * monthlyPrice
```

---

## Features por Módulo

### 1. Autenticación
- Login con email/contraseña
- Sin registro público (usuarios se crean desde Accesos)
- Sesión persistente

### 2. Lista de Clientes
- Grid de cards con información resumida
- Foto placeholder con iniciales
- Tier cognitivo con colores
- Días de recupero disponibles
- Días de la semana asignados
- Horario (mañana/tarde/día completo)
- Contacto de emergencia
- Filtros: tier cognitivo, frecuencia, transporte
- Búsqueda por nombre, teléfono, dirección

### 3. Detalle de Cliente
- **Tabs de información**:
  - General: nombre, email, teléfono, fecha nacimiento, tier, fecha ingreso
  - Contacto y Dirección: emergencia, dirección con detalles de acceso
  - Información Médica: restricciones, medicación, notas

- **Card de resumen**: tier, plan, días asignados, transporte, días de recupero

- **Acciones**:
  - Editar cliente
  - Marcar falta (si hoy es día asignado)
  - Recuperar día (si hay días disponibles)
  - Dar de baja (menú de opciones)

- **Calendario de asistencia**:
  - Scroll horizontal de meses
  - Grilla de días con colores según estado
  - Tooltips informativos
  - Edición de estado al hacer clic
  - Monto cobrable vs potencial
  - Botones de facturación/cobro por mes

### 4. Alta de Cliente (Wizard 3 pasos)
1. **Datos personales y contacto**: nombre, email, teléfono, fecha nacimiento, tier cognitivo, fecha ingreso, contacto emergencia, dirección
2. **Plan y asistencia**: frecuencia, horario, días asignados, transporte, precio estimado
3. **Información médica**: restricciones alimentarias/médicas/movilidad, medicación, notas

### 5. Accesos (Usuarios del sistema)
- Lista de usuarios con rol
- Crear/editar/eliminar usuarios
- Roles: Admin y Superadmin
- Indicador visual del usuario actual

### 6. Proveedores (Solo Superadmin)
- Lista de proveedores por categoría
- CRUD de proveedores
- Categorías: Alimentación, Limpieza, Transporte, Salud, Insumos, etc.

### 7. Gastos (Solo Superadmin)
- Gastos recurrentes vs extraordinarios
- Asociados a proveedores
- Estados: pendiente/pagado
- Resumen mensual

### 8. Transporte (`/transporte`)
- Programación diaria de vehículos para clientes con transporte
- Navegación por día (salta fines de semana)
- 4 turnos fijos: Llegada mañana (9:00), Salida mañana (14:00), Llegada tarde (15:00), Salida tarde (19:00)
- Panel split: Google Maps con pins coloreados por auto + panel DnD de asignación
- Autos editables: nombre, asientos, agregar/eliminar por turno
- Drag & drop de clientes entre pool sin asignar y autos (usa @dnd-kit)
- "Repetir último [día]": copia configuración del mismo día de la semana anterior
- Guardado atómico vía RPC `save_transport_day`
- Cuenta de viajes por cliente por día (0-2) persistida en `transport_trip_counts`

---

## Roles y Permisos

### Superadmin
- ✅ Acceso completo a todo el sistema
- ✅ Gestión de usuarios
- ✅ Proveedores y gastos
- ✅ Estadísticas (futuro)

### Admin
- ✅ Gestión de clientes
- ✅ Gestión de asistencias
- ✅ Facturación
- ❌ Proveedores y gastos
- ❌ Estadísticas

---

## Estructura de Archivos

```
src/
├── components/
│   ├── Layout/
│   │   ├── Layout.jsx        # Layout con protección de rutas
│   │   └── Navbar.jsx        # Navegación superior
│   └── ui/
│       ├── Button.jsx
│       ├── Card.jsx
│       ├── Filters.jsx       # Componente de filtros reutilizable
│       ├── Input.jsx         # Input, Select, Textarea, Checkbox
│       ├── Modal.jsx
│       └── Tabs.jsx
├── context/
│   └── AuthContext.jsx       # Estado de autenticación (Supabase)
├── pages/
│   ├── Access/
│   │   └── AccessList.jsx
│   ├── Clients/
│   │   ├── AddClient.jsx     # Wizard de alta
│   │   ├── ClientDetail.jsx  # Detalle + calendario
│   │   └── ClientList.jsx    # Lista con filtros
│   ├── Dashboard/
│   │   └── Dashboard.jsx     # Métricas y resumen
│   ├── Groups/
│   │   └── DailyGroups.jsx   # Grupos diarios con DnD
│   ├── Suppliers/
│   │   └── SupplierList.jsx
│   ├── Transport/
│   │   ├── TransportScheduler.jsx  # Página principal
│   │   ├── TransportMap.jsx        # Google Maps con pins
│   │   ├── CarAssignmentPanel.jsx  # Panel DnD de autos
│   │   ├── CarCard.jsx             # Card de auto individual
│   │   └── ClientChip.jsx          # Chip draggable de cliente
│   └── Login.jsx
├── services/
│   ├── supabase/
│   │   └── client.js         # Cliente Supabase
│   ├── auth/
│   │   └── authService.js    # Login, logout, sesión
│   ├── clients/
│   │   ├── clientService.js  # CRUD clientes
│   │   └── clientTransformers.js
│   ├── attendance/
│   │   └── attendanceService.js
│   ├── invoices/
│   │   └── invoiceService.js
│   ├── suppliers/
│   │   └── supplierService.js
│   ├── expenses/
│   │   └── expenseService.js
│   ├── pricing/
│   │   └── pricingService.js
│   ├── transport/
│   │   ├── transportConstants.js  # Turnos, colores, flota, precios
│   │   └── transportService.js    # CRUD transporte, RPC save
│   ├── users/
│   │   └── userService.js
│   └── api.js                # Facade (re-exports)
├── App.js                    # Rutas
├── index.js
├── index.css                 # Tailwind directives
└── tailwind.output.css       # CSS compilado

supabase/
├── migrations/
│   ├── 001_schema.sql        # Tablas
│   ├── 002_indexes.sql       # Índices
│   ├── 003_rls_policies.sql  # Row Level Security
│   ├── 004_views.sql         # Vistas
│   ├── 005_functions.sql     # Funciones RPC
│   ├── 006_triggers.sql      # Triggers
│   ├── 007_seed_pricing.sql  # Datos iniciales
│   ├── 008_billing_overhaul.sql
│   ├── 010_daily_groups.sql
│   ├── 011_client_avatars.sql
│   └── 012_transport_scheduling.sql  # Transporte: tablas, RPC, cleanup
└── README.md                 # Guía de setup
```

---

## Comandos Importantes

```bash
# Desarrollo
npm start

# Compilar Tailwind (ejecutar después de cambios de estilos)
npx tailwindcss -i ./src/index.css -o ./src/tailwind.output.css

# Build producción
npm run build
```

---

## Reglas de Negocio

### Días de Recupero
1. Se otorga 1 día cuando se marca falta justificada con recupero (`justified_recovered`)
2. Se consume 1 día cuando se usa el botón "Recuperar día"
3. Los días recuperados se marcan con estado `recovered`
4. Los días recuperados SE COBRAN

### Facturación
1. Los meses se cobran **por adelantado**
2. Vencimiento: **día 10 de cada mes**
3. El monto se calcula según días planificados (editables)
4. Faltas `justified_not_recovered` NO se cobran
5. Todo lo demás SE COBRA (asistencias, faltas injustificadas, recuperos)
6. Estado de factura y pago son **independientes**

### Precios (Asistencia)
- 8 combinaciones base: 4 frecuencias × 2 horarios (mañana/tarde tienen mismo precio)
- Día completo tiene precio mayor
- `hasTransport` en el perfil del cliente indica si usa transporte (no afecta precio de asistencia)

### Transporte (Facturación separada)
- Facturación de transporte es completamente independiente de la facturación de asistencia
- Se cobra por viaje: cantidad de turnos asignados por día (máximo 2: llegada + salida)
- Precio por viaje determinado por el plan del cliente (frecuencia × horario)
- Precios hardcodeados en `transportConstants.js` (futuro: pantalla de superadmin)

---

## Próximas Iteraciones

### Backend (Completado)
- [x] Arquitectura modular de servicios
- [x] Modelado de base de datos PostgreSQL
- [x] Vistas para JSON anidado
- [x] Funciones RPC para operaciones atómicas
- [x] Row Level Security por rol
- [x] Autenticación con Supabase Auth
- [x] Integración frontend-backend

### Pendiente: Setup Supabase
- [ ] Crear proyecto en Supabase
- [ ] Ejecutar migraciones SQL
- [ ] Crear usuarios de prueba
- [ ] Probar flujo completo

### Futuras Features
- [ ] Integración con facturación electrónica
- [ ] Módulo de estadísticas
- [x] Módulo de transporte (programación diaria + trip counts)
- [ ] Geocoding de direcciones (Google Places Autocomplete en alta de cliente)
- [ ] Pantalla superadmin para editar precios de transporte
- [ ] Facturación de transporte (consumir trip counts para generar facturas separadas)
- [ ] Edición de días planificados por mes
- [ ] Notificaciones de vencimiento de pago
- [ ] Reportes exportables
- [ ] Historial de cambios (auditoría)

---

## Instrucciones Generales (Para Claude)

### Workflow Orchestration

#### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately - don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

#### 2. Subagent Strategy to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

#### 3. Self-Improvement Loop
- After ANY correction from the user: update 'tasks/lessons.md' with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

#### 4. Verification Before Done
- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

#### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes - don't over-engineer
- Challenge your own work before presenting it

#### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests -> then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

### Task Management
1. **Plan First**: Write plan to 'tasks/todo.md' with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review to 'tasks/todo.md'
6. **Capture Lessons**: Update 'tasks/lessons.md' after corrections

---

## Principios de Código

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

### Code Style
- Variables y código en inglés
- Textos de UI en español
- No usar `;` en JS/JSX/TS/TSX cuando no es obligatorio
- Comentar `// MOCKED RES` en datos y funciones mockeadas
