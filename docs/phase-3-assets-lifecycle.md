# Phase 3 — Asset Registration, Directory & Lifecycle

## Objective

Register assets, give each a unique auto-generated tag (AF-0001), model the full
lifecycle as an explicit state machine, and make assets searchable/filterable. This
is Screen 4. It also lays the per-asset history foundation that Phases 4 and 5 append
to.

The crown-jewel concurrency work is Phase 4 — but the **state machine defined here**
is what Phase 4/5 transitions must respect, so getting the allowed-transition table
right now saves pain later.

## Depends on

Phase 2 (categories, departments, employees exist). Phase 1 (RBAC).

## Parallelizable

✅ Track A, continues from Phase 2. Phase 4 (allocation/booking) depends on this.

---

## Lifecycle states & allowed transitions (the contract)

States: `AVAILABLE`, `ALLOCATED`, `RESERVED`, `UNDER_MAINTENANCE`, `LOST`, `RETIRED`,
`DISPOSED`.

The problem statement gives examples (Available ↔ Under Maintenance, Allocated →
Available). Model transitions **explicitly** and reject anything not in the table —
don't let arbitrary status writes happen. Later phases call a single
`transition(asset, event)` method; they never `setStatus()` directly.

```
                 allocate                    return
   AVAILABLE ───────────────► ALLOCATED ───────────────► AVAILABLE
       │  ▲                       │
 reserve│  │release/expire        │ (holder raises + AM approves maintenance)
       ▼  │                       ▼
   RESERVED                  UNDER_MAINTENANCE ──resolve──► AVAILABLE
       │                           ▲
       │ maintenance approved      │ maintenance approved (from AVAILABLE too)
       └───────────────────────────┘

   AVAILABLE / ALLOCATED / RESERVED ──audit: confirmed missing──► LOST
   AVAILABLE ──retire──► RETIRED ──dispose──► DISPOSED
```

Encode as an allowed-set map:

```java
public enum AssetStatus { AVAILABLE, ALLOCATED, RESERVED, UNDER_MAINTENANCE, LOST, RETIRED, DISPOSED }

public enum AssetEvent {
    ALLOCATE, RETURN, RESERVE, RELEASE_RESERVATION,
    START_MAINTENANCE, RESOLVE_MAINTENANCE,
    MARK_LOST, RETIRE, DISPOSE
}

// from-status -> event -> to-status
private static final Map<AssetStatus, Map<AssetEvent, AssetStatus>> T = Map.of(
    AVAILABLE, Map.of(
        ALLOCATE, ALLOCATED,
        RESERVE, RESERVED,
        START_MAINTENANCE, UNDER_MAINTENANCE,
        MARK_LOST, LOST,
        RETIRE, RETIRED),
    ALLOCATED, Map.of(
        RETURN, AVAILABLE,
        START_MAINTENANCE, UNDER_MAINTENANCE,   // holder raises, AM approves
        MARK_LOST, LOST),
    RESERVED, Map.of(
        ALLOCATE, ALLOCATED,
        RELEASE_RESERVATION, AVAILABLE,
        MARK_LOST, LOST),
    UNDER_MAINTENANCE, Map.of(
        RESOLVE_MAINTENANCE, AVAILABLE),
    RETIRED, Map.of(
        DISPOSE, DISPOSED)
    // LOST and DISPOSED are terminal — no outgoing transitions.
);

@Transactional
public void transition(Asset asset, AssetEvent event) {
    AssetStatus from = asset.getStatus();
    AssetStatus to = Optional.ofNullable(T.get(from)).map(m -> m.get(event))
        .orElseThrow(() -> new IllegalTransitionException(from, event));
    asset.setStatus(to);
    assets.save(asset);
}
```

> Phase 4 wraps `ALLOCATE`/`RETURN` inside the same transaction that creates/closes
> the allocation row and takes the asset-row lock. Phase 5 wraps
> `START_MAINTENANCE`/`RESOLVE_MAINTENANCE`. This method is the single choke point
> for status changes — that's the point.

---

## Schema (Flyway migration in `core-service`)

`V4__assets.sql`:

```sql
CREATE TABLE assets (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_tag        VARCHAR(20)  NOT NULL UNIQUE,     -- e.g. AF-0001
    name             VARCHAR(160) NOT NULL,
    category_id      BIGINT NOT NULL REFERENCES asset_categories(id),
    serial_number    VARCHAR(120) UNIQUE,
    acquisition_date DATE,
    acquisition_cost NUMERIC(14,2),                    -- ranking/reports ONLY, not accounting
    condition        VARCHAR(20) NOT NULL DEFAULT 'GOOD'
                       CHECK (condition IN ('NEW','GOOD','FAIR','POOR','DAMAGED')),
    location         VARCHAR(160),
    is_bookable      BOOLEAN NOT NULL DEFAULT FALSE,    -- "shared/bookable" flag
    status           VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
                       CHECK (status IN ('AVAILABLE','ALLOCATED','RESERVED',
                                         'UNDER_MAINTENANCE','LOST','RETIRED','DISPOSED')),
    custom_values    JSONB NOT NULL DEFAULT '{}'::jsonb, -- values for category custom_fields
    photo_url        VARCHAR(512),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_assets_status     ON assets(status);
CREATE INDEX idx_assets_category   ON assets(category_id);
CREATE INDEX idx_assets_location   ON assets(location);
CREATE INDEX idx_assets_serial     ON assets(serial_number);

-- Per-asset history feed (append-only). Allocation/maintenance/audit events all land here.
CREATE TABLE asset_history (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id    BIGINT NOT NULL REFERENCES assets(id),
    event_type  VARCHAR(40) NOT NULL,      -- ALLOCATED, RETURNED, TRANSFERRED, MAINT_*, AUDIT_*, STATUS_CHANGE
    detail      TEXT,
    actor_id    BIGINT REFERENCES employees(id),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_asset_history_asset ON asset_history(asset_id, occurred_at DESC);
```

`docs`/multi-file attachments: for the hackathon, a single `photo_url` (or a small
`asset_documents` table if you want multiple) is enough. Don't build a file service —
accept a URL, or store uploads to a local/S3-ish bucket and keep the URL. Keep it
lightweight.

---

## Verbatim: race-free asset tag generation

`AF-0001`, `AF-0002`, … must be **unique under concurrent registration**. Do not do
`SELECT max(...) + 1` in app code (two concurrent registers collide). Use a Postgres
sequence + formatting — atomic by construction.

`V4__assets.sql` (continued):

```sql
CREATE SEQUENCE asset_tag_seq START 1;
```

Java:

```java
@Service
public class AssetTagService {
    private final JdbcTemplate jdbc;

    // nextval is atomic; no two callers get the same number.
    public String nextTag() {
        long n = jdbc.queryForObject("SELECT nextval('asset_tag_seq')", Long.class);
        return "AF-%04d".formatted(n);   // AF-0001, ... AF-9999, then AF-10000
    }
}
```

The `UNIQUE` constraint on `asset_tag` is the final safety net; the sequence makes
collisions not happen in the first place.

---

## Endpoints (core-service, `/api/assets`)

| Method | Path                          | Auth                          | Notes                                   |
|--------|-------------------------------|-------------------------------|-----------------------------------------|
| POST   | `/api/assets`                 | ASSET_MANAGER, ADMIN          | register → tag auto-assigned, status AVAILABLE |
| PUT    | `/api/assets/{id}`            | ASSET_MANAGER, ADMIN          | edit metadata (not status directly)     |
| GET    | `/api/assets`                 | any authenticated             | search/filter (see params)              |
| GET    | `/api/assets/{id}`            | any authenticated             | detail incl. current holder             |
| GET    | `/api/assets/{id}/history`    | any authenticated             | allocation + maintenance history        |
| PATCH  | `/api/assets/{id}/retire`     | ASSET_MANAGER, ADMIN          | AVAILABLE → RETIRED                      |
| PATCH  | `/api/assets/{id}/dispose`    | ASSET_MANAGER, ADMIN          | RETIRED → DISPOSED                       |

> There is **no** generic "set status" endpoint. Status changes only via specific,
> validated actions (allocate/return in Phase 4, maintenance in Phase 5, retire/
> dispose here) so the state machine can't be bypassed.

### Search / filter params (`GET /api/assets`)

`?tag=&serial=&category=&status=&department=&location=&bookable=&q=&page=&size=`

- `q` is a free-text match across name/tag/serial (ILIKE is fine at this scale).
- QR code: encode the asset tag (or asset id) in the QR; scanning yields the tag,
  which is just the `tag=` filter. No separate QR field needed in the DB — the QR
  *contains* the tag. (Optional: render a QR from the tag on the detail page.)
- Paginate (`Pageable`); the directory can be large.

---

## Definition of done

- Registering an asset auto-assigns a unique `AF-000N` tag (proven race-free by the
  sequence) and sets status `AVAILABLE`.
- Concurrent registrations never collide on tag or serial.
- The state machine rejects illegal transitions (e.g. `DISPOSED → ALLOCATED` throws);
  all status changes route through `transition(asset, event)`.
- Search/filter works across tag, serial, category, status, department, location, and
  free-text; results paginate.
- `GET /api/assets/{id}/history` returns the (initially small) append-only history
  feed that later phases will populate.
- No endpoint allows setting an arbitrary status.
