# Dashboard Analítico + Módulo de Seguimiento de Bajas

## Contexto / decisiones de diseño (decididas autónomamente, perspectiva de administrador del negocio)

- El dashboard actual es un **command center financiero** (chart ingresos/gastos + KPIs + panel de cobranza), gated `dashboard_financials` (superadmin). Se preserva íntegro como una pestaña.
- Se reestructura el dashboard en **pestañas de secciones** (tabs de primer nivel), y dentro de cada métrica **sub-tabs de breakdown** (misma métrica, distintas vistas: por plan, por horario, por tier cognitivo, en el tiempo).
- El **seguimiento de bajas** es un módulo aparte (kanban mini-CRM) en su propia ruta, accesible a **todos los usuarios**. El dashboard solo muestra la *analítica* de bajas (tasa, motivos, MRR perdido, tendencia) con link al módulo.
- Datos ya disponibles: bajas totalmente modeladas (`deleted_at`, `deactivation_date`, `deactivation_reason` [8 enums], `deactivation_notes`), planes (`client_plans`: frequency 1-5, schedule), pricing (`plan_pricing`), facturación (`monthly_invoices` + RPC live `calculate_month_billing`), asistencia (`attendance_records`).
- Patrón de charts: **SVG puro, sin librería** (se mantiene). Patrón DnD: **@dnd-kit**, un `DndContext`, `PointerSensor`, updates optimistas (se reutiliza para el kanban).
- Próxima migración: **038**.

## Estructura del Dashboard (nueva)

Tabs de primer nivel:
1. **Finanzas** (existente, superadmin) — se extrae a `sections/FinanceSection.jsx` sin cambios de comportamiento.
2. **Asistencia** (nuevo) — estadísticas de asistencia con sub-tabs de breakdown.
3. **Comercial** (nuevo, "la más comercial") — mix de facturación por plan/horario/tier + analítica de bajas.

### Sección Asistencia
- KPIs: tasa de asistencia global del mes, ausencias justificadas vs injustificadas, recuperos, ocupación.
- Chart de tendencia de tasa de asistencia (mensual).
- **Sub-tabs de breakdown de la misma métrica** (tasa de asistencia / cupos ocupados): por **frecuencia de plan** | por **horario** | por **tier cognitivo**.
- Gating: `statistics` (se amplía a admin+superadmin — asistencia es operativa, no sensible financieramente).

### Sección Comercial
- Composición de la base activa: clientes por plan / horario / tier (donut + breakdown bars, con sub-tabs de dimensión).
- **Mix de facturación**: qué planes/horarios aportan más a la facturación (barras horizontales, sub-tab dimensión: plan | horario | tier), con % de contribución.
- Altas vs Bajas por mes (barras net-growth) + MRR ganado/perdido.
- **Analítica de bajas**: tasa de churn, bajas por motivo (los 8 enums), MRR perdido por churn, días promedio de permanencia. Link "Ver seguimiento de bajas →" al módulo kanban.
- Gating: `dashboard_financials` (superadmin, involucra dinero).

## Plumbing de datos

- `get_attendance_stats(p_from_year,p_from_month,p_to_year,p_to_month)` (RPC, migración 038): agrega `attendance_records` JOIN `client_plans` → filas por (año, mes, frequency, schedule, cognitive_level) con conteos por status. `SECURITY INVOKER`.
- Comercial/base/altas/bajas: se computa **client-side** desde `getClients({includeDeleted:true})` (ya trae startDate, deactivationDate, deactivationReason, plan anidado) + `getPlanPricing()`. Sin RPC nuevo. Lógica pura en `commercialStats.js` (testeable).
- Mix de facturación por dimensión: RPC `get_billing_breakdown_rows(p_year,p_month)` → por cliente: {frequency, schedule, cognitiveLevel, attNet/Gross, transNet/Gross, isDeactivated}. Reusa `calculate_month_billing`. Frontend pivotea por la dimensión del sub-tab. `SECURITY INVOKER`.
- Lógica pura de agregación en `attendanceStats.js` (mapea RPC → series por dimensión) con tests.

## Toolkit de charts (SVG, reutilizable)

Nuevo `src/pages/Dashboard/charts/`:
- `MetricTabs.jsx` — control de sub-tabs para cambiar breakdown de una métrica.
- `BreakdownBars.jsx` — barras horizontales ordenadas por contribución con % y montos.
- `DonutChart.jsx` — composición de base (share por categoría).
- `TrendLine.jsx` / `GroupedBars.jsx` — tendencia mensual / altas vs bajas.
- `StatCard.jsx` — KPI card reutilizable (extraído del patrón de KpiRow).

## Módulo Seguimiento de Bajas (kanban mini-CRM)

- Ruta `/bajas`, nav item (icono de iconoir), `access: 'clients'` (todos los usuarios).
- Migración **038** (mismo archivo): tablas
  - `churn_followups` (client_id PK/FK, stage, assigned_to NULL, created_at, updated_at). Stages: `new | contacting | negotiating | recovered | lost`.
  - `churn_followup_notes` (id, client_id FK, author_id, body, created_at) — activity log.
  - RLS: lectura/escritura para todos los roles autenticados.
  - RPC `get_churn_board()`: devuelve por cliente dado de baja su followup (auto-default stage por motivo: `death`→`lost`, resto→`new` si no existe fila), + datos del cliente (nombre, avatar, motivo, fecha baja, días desde baja, MRR último plan).
- Provisión lazy: `get_churn_board` hace upsert de filas faltantes para cada cliente con `deleted_at IS NOT NULL`.
- Componentes:
  - `src/pages/Churn/ChurnBoard.jsx` — página kanban (DndContext, columnas por stage).
  - `ChurnColumn.jsx`, `ChurnCard.jsx` (nombre, motivo badge, días, MRR), `ChurnCardModal.jsx` (detalle + activity log + notas + botón "Reactivar cliente" que llama `reactivateClient` al mover a `recovered`).
- Servicio `src/services/churn/churnService.js`: `getChurnBoard()`, `updateChurnStage(clientId, stage)`, `addChurnNote(clientId, body)`, `assignChurn(clientId, userId)`.
- DnD: drag card entre columnas → `updateChurnStage` optimista. Mover a `recovered` ofrece reactivar cliente.

## Fases de ejecución

- [x] **Fase 0 — Migración 038** (RPCs de stats + tablas churn + RLS). Aplicada + smoke test contra datos reales.
- [x] **Fase 1 — Toolkit de charts SVG** (`charts/`) + `StatCard`.
- [x] **Fase 2 — Servicios + lógica pura** (`attendanceStats.js`, `commercialStats.js`, `getBillingBreakdown`) + 22 tests.
- [x] **Fase 3 — Dashboard tabbed shell** + `FinanceSection` extraída (mismo comportamiento) + `monthWindow.js` compartido.
- [x] **Fase 4 — AttendanceSection** (KPIs + trend + breakdown sub-tabs).
- [x] **Fase 5 — CommercialSection** (base composition + mix facturación + altas/bajas + analítica de churn).
- [x] **Fase 6 — Módulo /bajas** (kanban DnD, servicio, modal + notas + reactivar).
- [x] **Fase 7 — RBAC** (`statistics` → admin+superadmin; nav Bajas para todos) + Tailwind rebuild + verificación.

## Review
- Migración 038 aplicada (con 2 fixes: `#variable_conflict use_column` y selección de plan vigente por `effective_from` — client_plans es versionado). RPCs verificadas: 8 filas asistencia, 44 clientes facturación, 5 tarjetas churn auto-provisionadas.
- Frontend: `npm run build` OK (+9.65 kB), 22 tests verdes, eslint limpio en todo lo nuevo.
- Dashboard ahora tabbed: Finanzas (superadmin, sin regresión) / Asistencia (admin+super) / Comercial (superadmin). Mes compartido entre pestañas; clic en barra del chart no re-fetchea.
- Módulo /bajas para todos los roles; kanban con DnD optimista, mover a "Recuperado" ofrece reactivar (flujo real `reactivateClient`).
- Pendiente opcional: verificación runtime en browser (build/tests OK); wire de `assignChurn` en UI (dejado para follow-up).

## Verificación
- `npm run build` limpio; recompilar Tailwind.
- Finanzas actual sin regresiones (mismo comportamiento tras extraer a sección).
- Bajas aparecen en kanban; drag actualiza stage; reactivar funciona vía flujo real.
- Roles: operador ve /bajas y no ve tabs financieros; superadmin ve todo.

## Review
(pendiente al finalizar)
