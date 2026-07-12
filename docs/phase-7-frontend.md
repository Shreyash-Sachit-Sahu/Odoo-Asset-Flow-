# Phase 7 — Frontend (Next.js)

## Objective

The responsive UI for all ten screens, talking **only** to the gateway (`:8080`).
Auth/token handling, role-aware routing and nav, the booking calendar, live
notifications, and the dashboard. A frontend dev should start day one, mocking each
endpoint until the matching backend phase lands.

## Depends on

Nominally Phase 1 (auth contract) to wire real login; everything else can be built
against mocked endpoints and swapped to real ones as phases complete. Structurally
this runs in parallel with all backend work.

## Stack

Next.js (App Router) on Node v24, TypeScript, Tailwind. You've shipped this exact
stack on Faraday (Tailwind v4, a Fraunces/Geist type system, SSE streaming) — reuse
that setup and sensibility. Claude Code has the `frontend-design` skill; let it drive
the visual system (typography, spacing, a real design direction rather than default
Bootstrap-y cards). Keep it clean, dense-but-legible — this is an internal operations
tool, so favour clarity and scannability over marketing polish.

---

## Cross-cutting: auth & the gateway

- **Single origin.** All calls go to the gateway (`NEXT_PUBLIC_API_BASE=http://localhost:8080`).
  Never call `:8081`/`:8082` directly — that's what the gateway + one-place CORS is for.
- **Token handling.** Store the access token in memory (or an httpOnly cookie if you
  want to be stricter); keep the refresh token in an httpOnly cookie ideally. On a 401,
  transparently call `/auth/refresh` once, retry the original request, and if that
  fails, bounce to login. Centralise this in a fetch wrapper / axios interceptor so no
  component thinks about tokens.
- **Role-aware everything.** Decode the role from `/auth/me` (or the token) and gate
  nav items, routes, and action buttons by the RBAC matrix (README / Phase 2). An
  employee never sees Org Setup or Register Asset; a department head sees dept-scoped
  views. Guard on the client for UX *and* rely on the server 403s for real security —
  the client gate is convenience, not the boundary.

---

## Screen-by-screen

### 1. Login / Signup

Email+password login, signup form (**no role field** — signup is Employee-only), forgot
-password + reset flows. Session validation on app load via `/auth/me`. Show a clear
"your role changes apply on next sign-in" note if relevant.

### 2. Dashboard / Home

The landing page after login. Role-scoped KPI cards from `GET /api/dashboard`:
Assets Available, Assets Allocated, Maintenance Today, Active Bookings, Pending
Transfers, Upcoming Returns — and **Overdue Returns visually distinct** (red/warning
treatment) from upcoming ones. Quick-action buttons (Register Asset / Book Resource /
Raise Maintenance) shown per role. Poll the dashboard endpoint on an interval or
refresh on nav; the backend cache makes this cheap.

### 3. Organization Setup (Admin only — 3 tabs)

Tabbed screen, Admin-gated at the route level.
- **Tab A Departments:** table + create/edit modal; parent-department picker (guard
  against selecting a descendant — surface the server's cycle error nicely); head
  assignment; active/inactive toggle.
- **Tab B Categories:** table + create/edit; optional custom-field definition editor
  (a small key→type list builder).
- **Tab C Employee Directory:** searchable table (name, email, dept, role, status);
  the **role dropdown is the only place roles change** and calls the Admin-only role
  endpoint. Show current holder count of admins so the "can't demote last admin" error
  makes sense.

### 4. Asset Registration & Directory

- **Register form:** name, category (drives the custom-field inputs), serial,
  acquisition date/cost, condition, location, photo, "shared/bookable" toggle. Tag is
  auto-assigned server-side — display it after create (AF-000N).
- **Directory:** searchable/filterable table (tag, serial, category, status,
  department, location, free-text). Status shown as a coloured chip per lifecycle
  state. Optionally render a QR from the tag on the detail view.
- **Asset detail:** metadata + current holder + the combined allocation/maintenance
  **history timeline** from `/api/assets/{id}/history`.

### 5. Asset Allocation & Transfer

- Allocate form (asset → employee/department, optional expected return date).
- **Conflict UX (this is a spec highlight):** on a 409 "already allocated", show
  *"currently held by {holder}"* and a **Request Transfer** button instead of a dead
  error. The transfer request flow: submit → shows as pending → approver
  (AM/dept-head-in-scope) approves/rejects → on approve the holder updates
  automatically.
- **Return:** mark-returned with a condition check-in note field.
- **Overdue:** allocations past expected return flagged in the list (and they already
  surface on the dashboard + notifications).

### 6. Resource Booking

- **Calendar view** of a resource's existing bookings (day/week). A library like
  FullCalendar or a simple custom grid both work; the data is overlap-free by
  construction so rendering is straightforward.
- **Book slot:** pick resource + start/end. On a 409 overlap, show a clear
  *"this slot overlaps an existing booking"* message. Demonstrate the boundary case in
  the demo (10:00–11:00 succeeds right after a 09:00–10:00 booking; 09:30–10:30 fails).
- Booking status chips (Upcoming/Ongoing/Completed/Cancelled); cancel + reschedule;
  the pre-slot reminder shows up as a notification.

### 7. Maintenance Management

- Raise request (asset, issue, priority, photo).
- Workflow board or status column showing Pending → Approved/Rejected → Technician
  Assigned → In Progress → Resolved, with the right action buttons per role (only
  AM/Admin see Approve/Reject/Resolve). Asset status visibly flips to Under Maintenance
  on approval.

### 8. Asset Audit

- Create cycle (scope: department/location, date range), assign auditors.
- **Auditor view:** the cycle's asset checklist; each row marks Verified / Missing /
  Damaged (only assigned auditors, only while OPEN).
- **Discrepancy report:** live list of Missing/Damaged items.
- **Close cycle:** confirm dialog explaining it locks the cycle and marks
  confirmed-missing assets as Lost. After close, the checklist is read-only.

### 9. Reports & Analytics

Charts + tables from the reports endpoints (or core aggregates if FastAPI was cut):
utilization trends, most-used vs idle, maintenance frequency, department allocation
summary, and the **booking heatmap** (weekday × hour grid — the visually strongest
one). Export buttons hit the CSV/XLSX endpoints and trigger a download.

### 10. Activity Logs & Notifications

- **Notifications:** a bell with unread count; a panel listing notifications
  (unread first); mark-read. Wire the optional SSE stream (`/api/notifications/stream`)
  for live push, or poll — you've done SSE on Faraday, so the streaming version is a
  nice touch.
- **Activity log:** an admin/manager view of the who-did-what-when audit trail with
  actor/entity/date filters.

---

## Notes for the demo

- Seed data matters more than features for a hackathon demo. Ship a seed script
  (departments, categories, ~30 assets in varied states, a few employees across roles,
  some bookings and an in-flight maintenance request) so every screen has something to
  show on load. Put this in the backend (a `dev` Flyway migration or a seeding
  endpoint), not the frontend.
- Pre-create one account per role (admin, asset manager, dept head, employee) so you
  can demo the RBAC differences by switching logins live.
- The two things to demo *slowly and deliberately*: the allocation conflict → transfer
  flow, and the booking overlap rejection with the boundary case. Those are where the
  real engineering shows.

## Definition of done

- Every screen renders and talks to the gateway; no direct-to-service calls.
- Login/refresh/logout work; a 401 transparently refreshes once then redirects on
  failure; role gates nav, routes, and action buttons.
- The allocation-conflict and booking-overlap error states are handled as first-class
  UX (transfer offer / clear overlap message), not raw error dumps.
- The calendar renders a resource's bookings; the maintenance and audit workflows are
  walkable end-to-end in the UI.
- Seed data + one account per role exist so the demo has content and can show RBAC.
