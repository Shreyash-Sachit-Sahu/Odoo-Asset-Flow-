# Phase 6 — Dashboard, Notifications & Reports

## Objective

The cross-cutting read/observe layer that sits on top of everything:

- **Dashboard** (Screen 2): role-aware KPI cards, overdue-vs-upcoming split, quick
  actions — with the **Redis caching** that makes it fast (this is the dashboard load
  concern from the kickoff, addressed at the right layer).
- **Notifications + Activity Log** (Screen 10): the event feed every earlier phase
  calls into, plus a full audit log of who-did-what-when.
- **Reports & Analytics** (Screen 9): the **optional FastAPI service** on a read
  replica — utilization trends, maintenance frequency, booking heatmap, exports.

## Depends on

Reads across all prior phases (4 and 5 must exist for the numbers to mean anything).
`NotificationService` and `ActivityLogService` are *called* by Phases 1–5 — scaffold
their interfaces early (empty no-op impls) so earlier phases compile, then fill them
here.

## Parallelizable

Partial. Stub the `NotificationService`/`ActivityLogService` interfaces in Phase 1 so
everything downstream can call them; implement the bodies + dashboard + reports here.

---

## Part 1 — Dashboard KPIs + the caching story (the load concern, fixed right)

### Why load-balancing the dashboard misses the bottleneck

The kickoff instinct was "dashboard gets the most load, so load-balance it." But the
six KPI cards are **aggregation reads** every user fires on login — `COUNT`/`GROUP BY`
against the DB. Load-balancing spreads the *HTTP requests* across app instances, but
every instance still runs the same aggregation against the same Postgres. That treats
the symptom. The bottleneck is the DB, and the lever is **caching + pre-aggregation +
serving reads from a replica**, not more app instances. Horizontal scaling is gravy
*after* the DB isn't doing the same COUNT for every user.

### KPI cards (spec)

Assets Available, Assets Allocated, Maintenance Today, Active Bookings, Pending
Transfers, Upcoming Returns — plus **Overdue Returns highlighted separately** from
upcoming ones.

Each is a cheap aggregate given the Phase 3–5 indexes:

```sql
-- examples (parameterise by role scope where relevant)
SELECT count(*) FROM assets WHERE status = 'AVAILABLE';
SELECT count(*) FROM assets WHERE status = 'ALLOCATED';
SELECT count(*) FROM maintenance_requests
  WHERE status IN ('APPROVED','TECHNICIAN_ASSIGNED','IN_PROGRESS')
    AND created_at::date = current_date;
SELECT count(*) FROM bookings WHERE status IN ('UPCOMING','ONGOING');
SELECT count(*) FROM transfer_requests WHERE status = 'REQUESTED';
-- upcoming returns (next 7 days, not yet overdue):
SELECT count(*) FROM allocations
  WHERE status = 'ACTIVE' AND expected_return_at BETWEEN now() AND now() + interval '7 days';
-- overdue returns (highlighted separately):
SELECT count(*) FROM allocations
  WHERE status = 'ACTIVE' AND expected_return_at < now();
```

### Verbatim: Redis-cached KPI payload

Compute the whole KPI bundle once, cache it in Redis with a short TTL, and invalidate
on the state transitions that change the numbers (allocate/return/book/cancel/approve/
resolve). Short TTL alone is enough for a hackathon; invalidation makes it feel live.

```java
@Service
public class DashboardService {

    private final DashboardRepository repo;      // runs the aggregate queries
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;

    private static final Duration TTL = Duration.ofSeconds(30);

    public DashboardKpis kpisFor(RoleScope scope) {
        String key = "kpis:" + scope.cacheKey();     // scope = role + dept for scoped views
        String cached = redis.opsForValue().get(key);
        if (cached != null) return readJson(cached);

        DashboardKpis fresh = repo.computeKpis(scope);   // the aggregate queries above
        redis.opsForValue().set(key, writeJson(fresh), TTL);
        return fresh;
    }

    // Called by allocation/booking/maintenance services after a state change.
    public void invalidate() {
        // simplest: delete all kpi keys. At hackathon key-count this is fine.
        Set<String> keys = redis.keys("kpis:*");
        if (keys != null && !keys.isEmpty()) redis.delete(keys);
    }
}
```

> **Pre-aggregation (stretch, if you want the strongest story):** instead of scanning
> on every read, keep counters (e.g. a small `kpi_counters` table or Redis hashes)
> updated on write in the same transaction as the state change. Read becomes O(1). For
> the hackathon, cached-aggregate is enough and simpler; mention pre-aggregation as
> the next step in your architecture narrative.

**Reads from a replica (paper + cheap real part):** point `DashboardRepository` and
the reports service at a read replica so analytical scans never touch the
transactional primary. In Compose you can run a second Postgres as a streaming
replica, or — for demo simplicity — just document the replica in the diagram and
point at the same DB. Either way the *code* is written to use a separate read
datasource, so the story is real even if the demo uses one node.

### Quick actions

Register Asset, Book Resource, Raise Maintenance Request — these are just shortcuts to
the Phase 3/4/5 endpoints, gated by the RBAC matrix (e.g. Register Asset only shows
for ASSET_MANAGER/ADMIN).

Endpoint: `GET /api/dashboard` → returns the cached KPI bundle + the overdue list,
scoped to the caller's role/department.

---

## Part 2 — Notifications + Activity Log

### Notifications

The event types from the spec: Asset Assigned, Maintenance Approved/Rejected, Booking
Confirmed/Cancelled/Reminder, Transfer Approved, Overdue Return Alert, Audit
Discrepancy Flagged. Every earlier phase already calls `notifications.xxx(...)`.

Schema:

```sql
CREATE TABLE notifications (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    recipient_id BIGINT NOT NULL REFERENCES employees(id),
    type        VARCHAR(40) NOT NULL,     -- ASSET_ASSIGNED, MAINT_APPROVED, ...
    message     TEXT NOT NULL,
    ref_type    VARCHAR(30),              -- asset/booking/maintenance/transfer/audit
    ref_id      BIGINT,
    is_read     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id, is_read, created_at DESC);
```

Delivery: for the hackathon, **in-app** (persist a row + let the frontend poll or use
SSE) is plenty. Endpoints:

```
GET   /api/notifications            -> caller's notifications (unread first)
PATCH /api/notifications/{id}/read  -> mark read
GET   /api/notifications/stream     -> optional SSE for live push
```

> **Async gotcha (Faraday):** if you send notifications with `@Async`, do **not** call
> the `@Async` method from within the same bean — self-invocation bypasses the proxy
> and runs synchronously. Keep `NotificationService` a separate bean that callers
> inject (which is already how Phases 1–5 use it), and put `@EnableAsync` on a config
> class if you go async. For the hackathon, synchronous in-app persistence is fine and
> avoids the trap entirely.

> **Optional — slim outbox from Relay:** if you want to show the event-driven flavour,
> the notification path is the *one* clean place to reuse a trimmed transactional
> outbox: state change + outbox row committed together, a poller turns outbox rows into
> notifications. **Keep it optional and scoped to notifications** — do not let it creep
> into the allocation/booking core, which is intentionally synchronous ACID. If it
> risks eating time, skip it; synchronous notifications are correct here.

### Activity Log (audit trail)

Who did what, when — across admin/manager/employee actions. `ActivityLogService.record(...)`
is called from role changes (Phase 2), allocations/transfers (Phase 4), maintenance/
audit (Phase 5), etc.

```sql
CREATE TABLE activity_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id    BIGINT REFERENCES employees(id),
    action      VARCHAR(40) NOT NULL,      -- ROLE_CHANGE, ALLOCATE, TRANSFER_APPROVE, ...
    entity_type VARCHAR(30),
    entity_id   BIGINT,
    detail      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_activity_actor ON activity_log(actor_id, created_at DESC);
CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id);
```

> **`@Transactional` rollback gotcha (Faraday):** if you want the activity log to
> record an action *even when the business transaction rolls back* (e.g. a failed
> attempt), write it in a `REQUIRES_NEW` transaction so it commits independently. If
> you only want to log *successful* actions, logging inside the same transaction is
> correct (it rolls back with the action). Decide per action; for a success audit
> trail, same-transaction is right.

Endpoint: `GET /api/activity?actor=&entity=&from=&to=` (ADMIN; managers scoped).

---

## Part 3 — Reports & Analytics (FastAPI, OPTIONAL, read replica)

Screen 9. Read-only aggregation + exports. This is where the Python service earns its
place — pandas makes the heatmap and CSV/XLSX exports trivial. **Cut it if time runs
short**; the core can serve basic report endpoints instead (the DDL supports both).

Reports to provide:

- Asset utilization trends; most-used vs. idle assets (from `allocations` history).
- Maintenance frequency by asset/category (from `maintenance_requests`).
- Assets due for maintenance or nearing retirement.
- Department-wise allocation summary.
- Resource booking heatmap — peak usage windows (from `bookings` ranges).
- Exportable reports (CSV / XLSX).

Shape:

```
FastAPI service (Python 3.11), routes under /reports/**  (via gateway)
  - reads a READ REPLICA (SQLAlchemy engine, read-only)   <-- keeps scans off primary
  - validates the same JWT (shared APP_JWT_SECRET, verify HS256) for authz
  - pandas for aggregation; the booking heatmap = pivot bookings by (weekday, hour)
  - exports: pandas .to_csv() / .to_excel() streamed as a file download
```

Endpoints (examples):

```
GET /reports/utilization           -> most-used vs idle, trend
GET /reports/maintenance-frequency -> by asset / category
GET /reports/allocation-summary    -> by department
GET /reports/booking-heatmap       -> weekday x hour matrix (for a heatmap render)
GET /reports/export/{report}?fmt=csv|xlsx -> file download
```

The heatmap is the visually impressive one and pandas makes it a few lines
(`df.pivot_table(index=weekday, columns=hour, values='count', aggfunc='sum')`). If you
drop FastAPI, implement `booking-heatmap` and the summaries as plain aggregate queries
in core and render client-side.

Gateway route (uncomment in Phase 0's config): `/reports/** -> reports-service:8000`.

---

## Definition of done

- `GET /api/dashboard` returns role-scoped KPI cards with **overdue returns separated
  from upcoming**, served from Redis cache (30s TTL) and invalidated on the relevant
  state changes — verify a repeated call hits cache, and an allocate/return busts it.
- Quick actions respect the RBAC matrix (Register Asset hidden from plain employees).
- Every workflow action from Phases 1–5 produces a notification to the right recipient
  and an activity-log entry; notifications are listable + markable-read.
- No async self-invocation, and security/audit writes survive (or intentionally roll
  back with) their transaction per the documented choice.
- Reports (if built): utilization, maintenance frequency, allocation summary, booking
  heatmap, and CSV/XLSX export all return; the reports service reads a replica and
  validates the shared JWT. (If cut: core serves the equivalent aggregates.)
