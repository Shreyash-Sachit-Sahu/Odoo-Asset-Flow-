# AssetFlow — Frontend Build Prompt (for Claude Code)

> **How to use this.** Run it in two moves, not one shot. First give Claude Code
> **Sections 1–4** (design system + app shell + API client + auth) and get
> login → dashboard working against the real gateway. Then feed **Section 5** screen
> by screen, in the order listed. Building the foundation first means every screen
> reuses the same typed client, the same components, and the same status system —
> which is what keeps a 10-screen app from turning into 10 different-looking apps.
>
> The API contracts (endpoints, payloads, roles) live in the phase-1 … phase-6
> briefs — treat those as the source of truth for request/response shapes. This
> prompt owns the frontend build and the design.

---

## 1. What you're building + hard constraints

Build the frontend for **AssetFlow**, an internal enterprise tool for tracking,
allocating, booking, maintaining, and auditing physical assets across an
organization. Users are staff, not consumers: Admins, Asset Managers, Department
Heads, and Employees. This is a dense, data-heavy operations tool — think dispatch
board / control panel, not marketing site. Clarity, scannability, and speed beat
polish-for-polish's-sake.

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS · Node v24. TanStack
Query for server state. Keep it a single codebase in `frontend/`.

**Non-negotiable constraints:**

- **One origin only.** Every API call goes to the gateway via
  `NEXT_PUBLIC_API_BASE` (e.g. `http://localhost:8080`). Never call a service port
  (`:8081`/`:8082`) directly, and never add `@CrossOrigin`-style workarounds — the
  gateway handles CORS. If a component fetches a raw service URL, that's a bug.
- **The server is the security boundary.** Client-side role gating is for UX only;
  the backend returns 403s that must be handled gracefully. Never assume hiding a
  button is "secure."
- **Quality floor, no exceptions:** responsive down to mobile, visible keyboard
  focus rings, `prefers-reduced-motion` respected, every list has a real empty state
  and every failure a directional error message (see §6).

---

## 2. Design direction (follow this exactly; it's a considered brief, not a default)

**The subject's world.** AssetFlow is about *physical, tagged things* moving through
a lifecycle — assets with printed labels (AF-0001), states, custody, schedules. The
design should feel like an *instrument for tracking those things*: precise,
legible-at-a-glance, a little technical. The whole app is really a visualization of
several state machines, so **state color is the core information-design problem**,
not decoration.

**Avoid the three AI-dashboard clichés.** Do NOT produce: (1) cream background
(#F4F1EA-ish) + high-contrast serif + terracotta/clay accent (#D97757); (2)
near-black background + one acid-green/vermilion accent; (3) broadsheet hairline
rules with zero border-radius and newspaper columns. If your first instinct lands on
one of these, change it.

**Signature element.** The **asset tag as a physical-label object**: render tags
(AF-0001) in a monospace, tabular, slightly letter-spaced chip with a hairline
border — evoking a real asset sticker/barcode label — and use it *consistently*
everywhere an asset appears (tables, detail headers, allocation cards, notifications).
On the asset detail page, pair it with a small generated QR of the tag. This one
device grounds the entire UI in the subject and is functional, not ornamental.

### Color tokens (starting system — refine values if you like, keep the discipline)

Neutral-forward, cool paper, one confident brand accent that sits *apart* from the
status hues. "Blueprint cobalt" as the brand color nods to technical drawings /
systematic tracking — it is deliberately deeper and more saturated than default
dashboard-blue.

```
/* Canvas & surfaces */
--paper:      #F6F7F9;   /* app background (cool near-white, NOT cream) */
--surface:    #FFFFFF;   /* cards, tables, modals */
--ink:        #17191F;   /* primary text (near-black, cool) */
--muted:      #5B6270;   /* secondary text, labels */
--faint:      #8A909C;   /* tertiary / placeholder */
--hairline:   #E4E7EC;   /* borders, dividers */
--hover:      #F0F2F5;   /* row / control hover fill */

/* Brand accent (actions, focus, active nav) — sits outside the status spectrum */
--cobalt-700: #2530B8;   /* pressed */
--cobalt-600: #2B36D9;   /* primary buttons, links, active */
--cobalt-500: #4B57F0;   /* hover */
--cobalt-050: #EEF0FE;   /* tinted backgrounds, active nav fill */
--focus-ring: #4B57F0;
```

### The status system (this is the backbone — one config object, used app-wide)

Seven asset states, plus booking / maintenance / audit states, each with a **fixed**
foreground / background / dot color. Define it once and drive every chip from it so
the app reads as a coherent state machine. Each chip = a colored dot + label; states
are distinguishable without relying on color alone (the label + dot shape carry it
too, for accessibility).

```ts
// statusSystem.ts — the single source of truth for state color
export const ASSET_STATUS = {
  AVAILABLE:         { label: "Available",         fg: "#067647", bg: "#ECFDF3", dot: "#17B26A" },
  ALLOCATED:         { label: "Allocated",         fg: "#1570EF", bg: "#EFF8FF", dot: "#2E90FA" },
  RESERVED:          { label: "Reserved",          fg: "#B54708", bg: "#FFFAEB", dot: "#F79009" },
  UNDER_MAINTENANCE: { label: "Under maintenance", fg: "#5925DC", bg: "#F4F3FF", dot: "#7A5AF8" },
  LOST:              { label: "Lost",              fg: "#B42318", bg: "#FEF3F2", dot: "#F04438" },
  RETIRED:           { label: "Retired",           fg: "#475467", bg: "#F2F4F7", dot: "#98A2B3" },
  DISPOSED:          { label: "Disposed",          fg: "#344054", bg: "#EAECF0", dot: "#667085" },
} as const;

export const BOOKING_STATUS = {
  UPCOMING:  { label: "Upcoming",  fg: "#1570EF", bg: "#EFF8FF", dot: "#2E90FA" },
  ONGOING:   { label: "Ongoing",   fg: "#067647", bg: "#ECFDF3", dot: "#17B26A" },
  COMPLETED: { label: "Completed", fg: "#475467", bg: "#F2F4F7", dot: "#98A2B3" },
  CANCELLED: { label: "Cancelled", fg: "#667085", bg: "#F2F4F7", dot: "#98A2B3" }, // + strikethrough
} as const;

export const MAINT_STATUS = {
  PENDING:             { label: "Pending",     fg: "#B54708", bg: "#FFFAEB", dot: "#F79009" },
  APPROVED:            { label: "Approved",    fg: "#1570EF", bg: "#EFF8FF", dot: "#2E90FA" },
  TECHNICIAN_ASSIGNED: { label: "Assigned",    fg: "#1570EF", bg: "#EFF8FF", dot: "#2E90FA" },
  IN_PROGRESS:         { label: "In progress", fg: "#5925DC", bg: "#F4F3FF", dot: "#7A5AF8" },
  RESOLVED:            { label: "Resolved",    fg: "#067647", bg: "#ECFDF3", dot: "#17B26A" },
  REJECTED:            { label: "Rejected",    fg: "#475467", bg: "#F2F4F7", dot: "#98A2B3" },
} as const;

export const AUDIT_RESULT = {
  VERIFIED: { label: "Verified", fg: "#067647", bg: "#ECFDF3", dot: "#17B26A" },
  MISSING:  { label: "Missing",  fg: "#B42318", bg: "#FEF3F2", dot: "#F04438" },
  DAMAGED:  { label: "Damaged",  fg: "#B54708", bg: "#FFFAEB", dot: "#F79009" },
} as const;
```

**Overdue** is an emphasis treatment, not a status: on an allocation row that's past
its expected return, add a red left-border and a small solid red "Overdue" pill —
distinct from the calm status chip. Overdue is the one thing on the dashboard allowed
to shout.

### Typography

- **UI + body:** **Geist** (you used it on Faraday — clean, modern, right for a dense
  tool). Set a tight, deliberate scale; don't rely on browser defaults.
- **Data / identifiers:** **Geist Mono**, with `font-variant-numeric: tabular-nums`,
  for asset tags, serials, IDs, timestamps, and all numeric table columns. This is
  what makes the tag-as-label signature work and keeps columns aligned.
- **Optional display face** for the login screen title and large dashboard numbers if
  you want more character — but the personality here comes from the tag treatment and
  status system, not a decorative headline font. Keep it restrained.

Type scale (starting point): page title 24/600, section 18/600, card/stat number
28–32/600 (mono, tabular), table header 12/600 uppercase tracked, body 14/400, label
12/500, mono tag 13/500 tracked.

### Layout & density

- **App shell:** left sidebar nav (role-filtered — see §4) + top bar (global asset
  search, notification bell with unread count, user menu). Content area max-width
  generous; tables go full width.
- **Tables are the primary surface.** Invest in one great table component: sticky
  header, compact rows (~44px), zebra-free with hairline row dividers, hover fill,
  **mono tags + right-aligned numbers**, status chip column, row → detail drawer.
  Sortable headers, a filter bar above, pagination below, and a real empty state.
- **Radius & depth:** soft but not pill — ~8px radius on cards/inputs/chips (6px on
  small chips). Shadows are subtle (a single low-opacity elevation for cards and
  drawers); rely on hairlines more than shadows. Not zero-radius (that's cliché #3),
  not heavily rounded.
- **Spacing:** dense but breathable — an ops user scans a lot of rows; 16–24px
  section padding, 8–12px control padding.

### Motion (restrained)

Row hover and chip transitions; a smooth right-side **drawer** for detail/edit
(assets, allocations, bookings) and centered modals for create; one orchestrated
moment — a gentle count-up on the dashboard KPI numbers on first load. That's it.
Respect `prefers-reduced-motion` (no count-up, instant transitions).

### Copy (design material, from the user's side)

Active-voice, sentence-case, consistent verbs through a whole flow: **Allocate ·
Return · Book · Approve · Resolve · Retire**. The button that says "Allocate"
produces a toast that says "Allocated." Name things by what the user controls
("Shared resources," "My assets"), never by system internals. Errors give direction,
never apologize or go vague (see §6). Empty states invite the next action ("No assets
yet — Register your first asset").

---

## 3. API client (build this before any screen)

A single typed client wrapping `fetch`, pointed at `NEXT_PUBLIC_API_BASE`, that all
data access goes through. It owns tokens and the refresh dance so no component ever
touches a raw token.

**Token handling:**
- Access token (short-lived JWT) held **in memory** in an auth store/context.
- Refresh token: simplest hackathon-correct option — keep it in memory too and, on
  app load, attempt a silent `/auth/refresh` to rehydrate the session so a page
  reload doesn't log the user out. (If you wire the gateway to set the refresh token
  as an httpOnly cookie, prefer that — but don't block on it.)
- On any `401`: call `/auth/refresh` **once**, and if it succeeds, transparently
  replay the original request with the new access token. If refresh fails, clear the
  session and redirect to `/login`. Guard against refresh loops (a single in-flight
  refresh promise shared by concurrent 401s).

**Shape:**

```ts
// api/client.ts
const BASE = process.env.NEXT_PUBLIC_API_BASE!;

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...opts.headers,
    },
  });

  if (res.status === 401 && !path.startsWith("/auth/")) {
    const refreshed = await tryRefreshOnce();      // shared in-flight promise
    if (refreshed) return request<T>(path, opts);  // replay once
    redirectToLogin();
    throw new ApiError(401, "Session expired");
  }
  if (!res.ok) throw await ApiError.from(res);     // carries status + parsed body
  return res.status === 204 ? (undefined as T) : res.json();
}
```

**`ApiError` must preserve the response body** so screens can react to specific
domain errors — the 409 conflict payloads (`currentHolder`, `canRequestTransfer`) and
the booking overlap message are the whole point of §5's hero flows. Don't collapse
errors to a string.

Wrap each domain in a typed module (`api/assets.ts`, `api/allocations.ts`,
`api/bookings.ts`, …) so screens call `assets.list(filters)` not raw paths. **Mock
layer:** give each module a mock implementation behind the same interface for
endpoints the backend hasn't shipped yet, toggled by an env flag — so swapping to
real is a one-line change and the frontend never blocks on the backend.

---

## 4. App shell, auth & role gating

**Auth store** (context or Zustand): `{ user: {id,email,role,name} | null,
accessToken, login(), logout(), isLoading }`. On mount: silent refresh → `/auth/me`
to hydrate. Expose a `useAuth()` hook.

**Route protection:** an authed layout that redirects to `/login` when there's no
session; `/login`, `/signup`, `/forgot`, `/reset` are public. Wrap the app in the
Query client + auth provider + a toast provider.

**Role-aware nav & actions** — filter by the RBAC matrix (source of truth: README /
phase-2 brief). Client gating is UX; server 403s still handled.

| Nav item            | ADMIN | ASSET_MANAGER | DEPT_HEAD | EMPLOYEE |
|---------------------|:-----:|:-------------:|:---------:|:--------:|
| Dashboard           |  ✅   |      ✅       |    ✅     |    ✅    |
| Assets              |  ✅   |      ✅       |    ✅     |    ✅ (own/scoped) |
| Allocation & Transfer|  ✅  |      ✅       |  ✅ scoped |  ✅ (own requests) |
| Bookings            |  ✅   |      ✅       |    ✅     |    ✅    |
| Maintenance         |  ✅   |      ✅       |    ✅     |    ✅ (raise/own) |
| Audit               |  ✅   |      ✅       |  auditor  |  auditor |
| Reports             |  ✅   |      ✅       |    —      |    —     |
| Org Setup           |  ✅   |       —       |    —      |    —     |
| Activity Log        |  ✅   |    scoped     |    —      |    —     |

Action buttons follow the same rules (e.g. **Register Asset** shows only for
ASSET_MANAGER/ADMIN; **Approve** buttons only for the approver role, and for
DEPT_HEAD only within their department).

**Login / Signup:** email+password login; signup form with **no role field** (signup
is Employee-only — do not add a role selector); forgot-password + reset flows. This
is the one screen you can let breathe visually (it's the first impression) — the tag /
control-board motif can appear here as an ambient background, but keep it disciplined.

**Deliverable for §1–4 (get this green before screens):** login works against the
real gateway, session survives reload via silent refresh, the shell renders with
role-filtered nav, and an unauthorized deep link redirects to login.

---

## 5. Screens (build in this order — optimized for demo impact; seed data covers deps)

Each screen: the endpoints it calls (contracts in the briefs), and the interactions
that matter. Reuse the shared table, chip, drawer, modal, and stat-card components.

### 5.1 Dashboard (`GET /api/dashboard`)
Role-scoped KPI stat cards: Assets Available, Allocated, Maintenance Today, Active
Bookings, Pending Transfers, Upcoming Returns — and **Overdue Returns rendered
distinctly** (red emphasis, separated from upcoming). Numbers in mono with the
first-load count-up. Quick-action buttons per role (Register Asset / Book Resource /
Raise Maintenance). Below the cards: a compact "Needs attention" list (overdue +
pending approvals) that deep-links into the relevant screen.

### 5.2 Assets — Directory + Register + Detail
- **Directory:** the flagship table. Filters: tag, serial, category, status,
  department, location, free-text (`q`). Tag column in the mono label chip; status
  chip; row → detail drawer. Paginated. `GET /api/assets?…`.
- **Register** (ASSET_MANAGER/ADMIN): form where **category drives the custom-field
  inputs** (render inputs from the category's `custom_fields` definition); name,
  serial, acquisition date/cost, condition, location, photo, **bookable** toggle. Tag
  is server-assigned — surface it in the success toast (`AF-0007 registered`).
  `POST /api/assets`.
- **Detail** (`GET /api/assets/{id}` + `/history`): tag-as-label header + generated
  QR, metadata, **current holder**, and the combined allocation/maintenance/audit
  **history timeline** (grouped by date, each event with actor + timestamp in mono).

### 5.3 Allocation & Transfer — **HERO FLOW #1**
- Allocate form (asset → employee or department, optional expected-return date).
  `POST /api/allocations`.
- **The conflict UX is the point.** On `409` (asset already allocated), do NOT show a
  raw error. Read `currentHolder` from the body and render an inline panel:
  *"Held by {holder} since {date}"* with a **Request transfer** button. That opens the
  transfer request form (`POST /api/transfer-requests`) → the request shows as
  **Pending** → the approver (AM/ADMIN, or DEPT_HEAD in-scope) sees it in a "Transfer
  requests" queue and Approves/Rejects (`PATCH …/approve|reject`) → on approve, the
  holder updates and both parties get a notification. Show this whole loop working.
- **Return:** mark-returned with a **condition check-in** note field
  (`PATCH …/return`); the asset chip flips to Available live.
- Overdue allocations flagged in the list with the red treatment.

### 5.4 Bookings — **HERO FLOW #2**
- **Calendar view** of a selected resource's bookings (day/week). Data is overlap-free
  by construction, so render straight. `GET /api/bookings?resourceId=&from=&to=`.
- **Book slot** (`POST /api/bookings`): pick resource + start/end. On `409` overlap,
  show a clear directional message: *"That slot overlaps an existing booking
  ({conflicting range}). Pick another time."* — never a raw 409.
- **Demo the boundary case on purpose:** after a 09:00–10:00 booking, a 10:00–11:00
  request **succeeds** and a 09:30–10:30 request **fails**. Make this easy to show.
- Status chips (Upcoming/Ongoing/Completed/Cancelled, cancelled struck-through);
  cancel + reschedule; pre-slot reminder arrives as a notification.

### 5.5 Maintenance (`/api/maintenance`)
- Raise request (asset, issue, priority, photo) — available to any role.
- **Workflow board:** columns or a status pipeline Pending → Approved/Rejected →
  Assigned → In Progress → Resolved, with role-gated action buttons (only AM/ADMIN
  see Approve/Reject/Resolve; technician sees Start). The asset's status visibly flips
  to **Under maintenance** on approval and back to Available on resolve — reflect that
  live in any open asset view.

### 5.6 Audit (`/api/audits`)
- Create cycle (scope: department/location + date range), assign auditors (ADMIN).
- **Auditor checklist view:** the cycle's asset list; each row marks Verified /
  Missing / Damaged (only assigned auditors, only while the cycle is Open).
- **Discrepancy report:** live-filtered list of Missing/Damaged items.
- **Close cycle:** a confirm dialog that spells out the consequence
  (*"Closing locks this cycle and marks confirmed-missing assets as Lost"*) —
  after close the checklist is read-only.

### 5.7 Org Setup (ADMIN only — 3 tabs) (`/api/departments`, `/api/categories`, `/api/employees`)
- **Departments:** table + create/edit; parent picker (surface the server's cycle
  error nicely if a descendant is chosen); head assignment; active/inactive.
- **Categories:** table + create/edit; a small **custom-field definition builder**
  (key → type rows) that Register (5.2) reads from.
- **Employee Directory:** searchable table (name, email, dept, role, status). The
  **role dropdown is the only place roles change** (`PATCH …/role`, ADMIN-only);
  surface the "can't demote the last admin" error clearly, and note that role changes
  apply on the user's next sign-in.

### 5.8 Reports (ADMIN/ASSET_MANAGER) (`/reports/**`, or core aggregates if FastAPI was cut)
Charts + tables: utilization trends, most-used vs idle, maintenance frequency,
department allocation summary, and the **booking heatmap** (weekday × hour grid — the
visually strongest one; render as a colored matrix). **Export** buttons hit the
CSV/XLSX endpoints and trigger a download.

### 5.9 Notifications & Activity Log (`/api/notifications`, `/api/activity`)
- **Notifications:** the top-bar bell with unread count + a panel (unread first,
  mark-read). Wire the **SSE stream** (`/api/notifications/stream`) for live push
  (you've done SSE on Faraday); fall back to polling if simpler. Each notification
  deep-links to its subject.
- **Activity log** (ADMIN/managers): who-did-what-when table with actor / entity /
  date filters.

---

## 6. Empty & error states (do not skip — they're where the app feels finished)

- **Empty lists** invite action, in the interface's voice: "No bookings for this
  resource yet — Book a slot." Not "No data."
- **Errors give direction, never apologize or go vague.** The 409 conflict and
  overlap flows above are the marquee examples; apply the same everywhere. A failed
  save says what to do next, not "Something went wrong."
- **403 from the server** (a role tried something the client didn't gate) → a calm
  "You don't have access to this action" inline, not a crash.
- **Loading:** skeleton rows for tables, not spinners-over-everything.

---

## 7. Definition of done

- Login/refresh/logout work against the gateway; session survives reload; a 401
  transparently refreshes once then redirects on failure.
- Nav, routes, and action buttons are role-gated per the matrix; server 403s handled.
- **No component calls a service port directly** — everything goes through the
  gateway client.
- The status system is a single config object; every chip in the app is driven by it
  and is consistent across screens.
- **Both hero flows work as first-class UX:** allocation conflict → "held by {holder}"
  → transfer request → approve → holder updates; booking overlap → clear directional
  message, with the boundary case (10:00–11:00 ok, 09:30–10:30 blocked) demonstrable.
- Asset tags render as the mono label chip everywhere; asset detail shows the QR +
  history timeline.
- Responsive to mobile, keyboard focus visible, reduced-motion respected, every list
  has an empty state and every failure a directional message.
- Seed data + one account per role make every screen show content on load and let you
  demo RBAC by switching logins.

Build the design system and shell first, prove login → dashboard against the real
gateway, then take the screens in order — reusing the shared table, chip, drawer, and
stat-card components throughout.
