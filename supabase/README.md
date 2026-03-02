# Supabase Backend Setup

Este directorio contiene los archivos de migración SQL para configurar la base de datos Supabase de Gervital.

## Configuración Inicial

### 1. Crear Proyecto en Supabase

1. Ir a [supabase.com](https://supabase.com) y crear un nuevo proyecto
2. Anotar la **Project URL** y **Anon Key** desde Settings > API

### 2. Configurar Variables de Entorno

Crear archivo `.env.local` en la raíz del proyecto:

```env
REACT_APP_SUPABASE_URL=https://tu-proyecto.supabase.co
REACT_APP_SUPABASE_ANON_KEY=tu-anon-key
REACT_APP_ENV=development
```

### 3. Ejecutar Migraciones

Ejecutar los scripts SQL en orden desde el SQL Editor de Supabase:

1. `001_schema.sql` - Crea todas las tablas
2. `002_indexes.sql` - Crea índices de rendimiento
3. `003_rls_policies.sql` - Configura Row Level Security
4. `004_views.sql` - Crea vistas para formato JSON anidado
5. `005_functions.sql` - Crea funciones de base de datos
6. `006_triggers.sql` - Crea triggers automáticos
7. `007_seed_pricing.sql` - Inserta matriz de precios

### 4. Crear Usuario de Prueba

Desde Authentication > Users en Supabase Dashboard:

1. Crear usuario `superadmin@gervital.com.uy` con contraseña `test123456`
2. Crear usuario `admin@gervital.com.uy` con contraseña `test123456`

Luego actualizar los roles en la tabla `users`:

```sql
UPDATE users SET role = 'superadmin' WHERE email = 'superadmin@gervital.com.uy';
UPDATE users SET role = 'admin' WHERE email = 'admin@gervital.com.uy';
```

## Estructura de Tablas

| Tabla | Descripción |
|-------|-------------|
| `users` | Usuarios del sistema (admin/superadmin) |
| `clients` | Clientes/asistentes del club |
| `client_plans` | Plan de cada cliente |
| `emergency_contacts` | Contacto de emergencia |
| `client_addresses` | Dirección con notas de acceso |
| `medical_info` | Información médica |
| `attendance_records` | Registros de asistencia diaria |
| `monthly_invoices` | Facturas mensuales |
| `plan_pricing` | Matriz de precios |
| `suppliers` | Proveedores |
| `expenses` | Gastos |

## Vistas

- `clients_full` - Clientes con datos anidados (plan, contacto, dirección, médico)
- `attendance_view` - Asistencia con formato de fecha
- `invoices_view` - Facturas con campos formateados
- `suppliers_view` - Proveedores formateados
- `expenses_view` - Gastos formateados
- `users_view` - Usuarios formateados

## Funciones RPC

| Función | Descripción |
|---------|-------------|
| `create_client_full()` | Crea cliente con todos los datos relacionados |
| `update_client_full()` | Actualiza cliente atómicamente |
| `consume_recovery_day()` | Usa día de recupero (valida y decrementa) |
| `increment_recovery_days()` | Incrementa días de recupero |
| `upsert_attendance()` | Inserta/actualiza asistencia con lógica de recupero |
| `get_plan_price()` | Calcula precio de plan |
| `get_expenses_summary()` | Resumen de gastos mensuales |

## Row Level Security

- **Todos los autenticados**: clients, attendance, invoices, plan_pricing (lectura)
- **Solo Superadmin**: users (escritura), suppliers, expenses

## Troubleshooting

### Error: "Usuario no encontrado en el sistema"
El trigger `handle_new_user` no creó el perfil. Verificar que el trigger está activo.

### Error: "No hay días de recupero disponibles"
El cliente no tiene días de recupero. Verificar el campo `recovery_days_available`.

### RLS blocking access
Verificar que el usuario tiene sesión activa y el rol correcto en la tabla `users`.
