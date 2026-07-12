# Phase 4 — The Concurrency Core: Allocation, Transfer & Booking

## Objective

This is the phase that wins or loses the project. Two invariants must hold **under
concurrent requests**, enforced at the database, not defended in app code:

1. **No double-allocation** — an asset has at most one active holder. Racing
   allocators get a hard, immediate "no" + a transfer offer.
2. **No overlapping bookings** — a bookable resource can't be double-booked for
   overlapping time slots, with the exact `[start, end)` semantics the spec gives.

Plus the workflows around them: transfer (request → approve → re-allocate), return
(with condition check-in), and overdue flagging that feeds the dashboard +
notifications. This is Screens 5 and 6.

The verbatim SQL and service code below is the point of the whole exercise — get it
exactly right.

## Depends on

Phase 3 (assets + state machine + `transition()`), Phase 2 (employees/departments),
Phase 1 (RBAC), Phase 0 (**`btree_gist` extension** — the booking constraint won't
compile without it).

## Parallelizable

✅ Track B — hand this to the strongest backend dev. It's independent of Phase 5.

---

## Part 1 — Allocation (no double-allocation)

### Schema — partial unique index is the DB guarantee

`V5__allocations.sql`:

```sql
CREATE TABLE allocations (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id           BIGINT NOT NULL REFERENCES assets(id),
    -- holder is an employee OR a department (exactly one set):
    holder_employee_id  BIGINT REFERENCES employees(id),
    holder_department_id BIGINT REFERENCES departments(id),
    allocated_by       BIGINT NOT NULL REFERENCES employees(id),
    allocated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expected_return_at TIMESTAMPTZ,                 -- nullable
    returned_at        TIMESTAMPTZ,
    return_condition   VARCHAR(20),
    return_notes       TEXT,
    status             VARCHAR(12) NOT NULL DEFAULT 'ACTIVE'
                        CHECK (status IN ('ACTIVE','RETURNED')),
    CONSTRAINT holder_exactly_one CHECK (
        (holder_employee_id IS NOT NULL)::int + (holder_department_id IS NOT NULL)::int = 1
    )
);

-- THE INVARIANT: at most one ACTIVE allocation per asset. Declarative, DB-enforced.
CREATE UNIQUE INDEX one_active_allocation_per_asset
    ON allocations (asset_id)
    WHERE status = 'ACTIVE';

CREATE INDEX idx_allocations_asset  ON allocations(asset_id);
CREATE INDEX idx_allocations_holder ON allocations(holder_employee_id);
-- Feeds overdue flagging:
CREATE INDEX idx_allocations_overdue
    ON allocations(expected_return_at)
    WHERE status = 'ACTIVE';
```

The partial unique index means a second `INSERT ... status='ACTIVE'` for the same
`asset_id` **fails at the DB** with a unique-violation, no matter how the app code is
written. That's the guarantee. But a raw DB error is a bad user experience — so the
service *also* takes a row lock to produce the clean "held by Priya, request a
transfer" message.

### Verbatim: allocation service — FOR UPDATE for UX, unique index for safety

Belt and suspenders. `SELECT ... FOR UPDATE` on the asset row serialises concurrent
allocators so we can give a friendly message; the unique index catches anything that
slips through any other code path.

Repository (pessimistic lock):

```java
public interface AssetRepository extends JpaRepository<Asset, Long> {
    @Lock(LockModeType.PESSIMISTIC_WRITE)          // SELECT ... FOR UPDATE
    @Query("SELECT a FROM Asset a WHERE a.id = :id")
    Optional<Asset> findByIdForUpdate(Long id);
}

public interface AllocationRepository extends JpaRepository<Allocation, Long> {
    Optional<Allocation> findByAssetIdAndStatus(Long assetId, AllocationStatus status);
}
```

Service:

```java
@Service
public class AllocationService {

    private final AssetRepository assets;
    private final AllocationRepository allocations;
    private final EmployeeRepository employees;
    private final AssetLifecycleService lifecycle;   // Phase 3 transition()
    private final AssetHistoryService history;
    private final NotificationService notifications;  // Phase 6

    @Transactional
    public Allocation allocate(AllocateRequest req, Long actingEmployeeId) {
        // Lock the asset row FIRST — two concurrent allocators now serialise here.
        Asset asset = assets.findByIdForUpdate(req.assetId())
            .orElseThrow(NotFoundException::new);

        // Clean conflict message: who currently holds it?
        Optional<Allocation> active =
            allocations.findByAssetIdAndStatus(asset.getId(), AllocationStatus.ACTIVE);
        if (active.isPresent()) {
            String holder = describeHolder(active.get());
            throw new AssetAlreadyAllocatedException(asset.getAssetTag(), holder);
            //  -> API maps this to 409 with { message, currentHolder, canRequestTransfer:true }
        }

        // Asset must be in an allocatable state (AVAILABLE or RESERVED-for-this-request).
        if (asset.getStatus() != AssetStatus.AVAILABLE
                && asset.getStatus() != AssetStatus.RESERVED) {
            throw new AssetNotAllocatableException(asset.getAssetTag(), asset.getStatus());
        }

        Allocation a = new Allocation();
        a.setAssetId(asset.getId());
        if (req.holderEmployeeId() != null)  a.setHolderEmployeeId(req.holderEmployeeId());
        else                                 a.setHolderDepartmentId(req.holderDepartmentId());
        a.setAllocatedBy(actingEmployeeId);
        a.setExpectedReturnAt(req.expectedReturnAt());
        a.setStatus(AllocationStatus.ACTIVE);
        allocations.save(a);              // unique index enforces the invariant here

        lifecycle.transition(asset, AssetEvent.ALLOCATE);   // AVAILABLE/RESERVED -> ALLOCATED
        history.record(asset.getId(), "ALLOCATED", describeHolder(a), actingEmployeeId);
        notifications.assetAssigned(a);

        return a;
    }
}
```

> **Why lock the asset row and not just rely on the index?** The index guarantees
> correctness (no double-allocation ever), but two racers would both get *past* the
> `findByAssetIdAndStatus` check and one would then hit a raw unique-violation — an
> ugly 500-ish error. The `FOR UPDATE` lock makes the second racer wait, re-read, see
> the now-active allocation, and get the friendly 409 with a transfer offer. Index =
> correctness; lock = UX. Show both to judges.

### The transfer workflow (when allocation is blocked)

Spec: `Requested → Approved (by Asset Manager / Department Head) → Re-allocated
(history updated automatically)`.

```sql
CREATE TABLE transfer_requests (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id       BIGINT NOT NULL REFERENCES assets(id),
    from_allocation_id BIGINT REFERENCES allocations(id),   -- the current holder's allocation
    requested_by   BIGINT NOT NULL REFERENCES employees(id),
    to_employee_id  BIGINT REFERENCES employees(id),
    to_department_id BIGINT REFERENCES departments(id),
    reason         TEXT,
    status         VARCHAR(12) NOT NULL DEFAULT 'REQUESTED'
                    CHECK (status IN ('REQUESTED','APPROVED','REJECTED')),
    decided_by     BIGINT REFERENCES employees(id),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at     TIMESTAMPTZ
);
```

Approve = one transaction that (a) locks the asset, (b) closes the current active
allocation (`status='RETURNED'`, no condition capture — it's a transfer, not a
physical return), (c) creates the new active allocation for the requested holder,
(d) records history, (e) notifies both parties. Because the old allocation flips out
of `ACTIVE` and the new one flips in **within one transaction**, the partial unique
index is never violated (there's never two ACTIVE rows at once).

RBAC: approver must be ASSET_MANAGER or ADMIN, **or** a DEPARTMENT_HEAD whose
department matches — enforce the scope, per the Phase 2 matrix.

### Return flow

Mark returned → capture condition check-in notes → asset reverts to `AVAILABLE`.

```java
@Transactional
public void returnAsset(Long allocationId, ReturnRequest req, Long actingEmployeeId) {
    Allocation a = allocations.findById(allocationId).orElseThrow(NotFoundException::new);
    if (a.getStatus() != AllocationStatus.ACTIVE)
        throw new NotActiveAllocationException();
    Asset asset = assets.findByIdForUpdate(a.getAssetId()).orElseThrow(NotFoundException::new);

    a.setStatus(AllocationStatus.RETURNED);
    a.setReturnedAt(Instant.now());
    a.setReturnCondition(req.condition());
    a.setReturnNotes(req.notes());
    allocations.save(a);

    lifecycle.transition(asset, AssetEvent.RETURN);   // ALLOCATED -> AVAILABLE
    history.record(asset.getId(), "RETURNED",
        "condition=%s".formatted(req.condition()), actingEmployeeId);
    notifications.assetReturned(a);
}
```

Return *approval*: the spec says Asset Manager approves returns + condition check-in.
For the hackathon you can either (a) let the holder mark returned and the AM confirm,
or (b) two-step: employee *initiates* return request → AM approves → the above runs.
Pick one; (a) is simpler, (b) matches the workflow language more literally. State the
choice in the UI.

---

## Part 2 — Booking (no overlaps) — the exclusion constraint

This is the single most impressive line in the codebase. Overlapping bookings become
**physically impossible** at the DB.

### Schema — `tstzrange` + GiST exclusion constraint

`V6__bookings.sql`:

```sql
-- Defensive: ensure the extension exists even on a fresh clone that skipped db/init.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE bookings (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    resource_id BIGINT NOT NULL REFERENCES assets(id),   -- an asset with is_bookable = true
    booked_by   BIGINT NOT NULL REFERENCES employees(id),
    on_behalf_of_department_id BIGINT REFERENCES departments(id),  -- dept head booking for dept
    during      TSTZRANGE NOT NULL,     -- [start, end)  half-open: end is exclusive
    status      VARCHAR(10) NOT NULL DEFAULT 'UPCOMING'
                 CHECK (status IN ('UPCOMING','ONGOING','COMPLETED','CANCELLED')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- No two ACTIVE bookings for the same resource may overlap in time.
    -- WITH = : same resource; WITH && : ranges overlap. The WHERE excludes
    -- cancelled/completed bookings so they don't block new ones.
    CONSTRAINT no_overlapping_bookings
        EXCLUDE USING gist (resource_id WITH =, during WITH &&)
        WHERE (status IN ('UPCOMING','ONGOING')),

    -- sanity: non-empty, positive-length slot
    CONSTRAINT valid_slot CHECK (lower(during) < upper(during))
);

CREATE INDEX idx_bookings_resource ON bookings(resource_id);
CREATE INDEX idx_bookings_during   ON bookings USING gist (during);
```

**Why `[start, end)` matters — it's the exact spec example.** `tstzrange(start, end)`
defaults to `'[)'`: lower-inclusive, upper-exclusive. So:

- Room B2 booked `09:00–10:00` = `[09:00, 10:00)`.
- Request `09:30–10:30` = `[09:30, 10:30)` → **overlaps** (09:30 is inside the first
  range) → the exclusion constraint rejects the INSERT. ✅ matches spec.
- Request `10:00–11:00` = `[10:00, 11:00)` → **no overlap** (10:00 is excluded from
  the first range, `&&` is false) → INSERT succeeds. ✅ matches spec.

You get the spec's boundary behaviour for free from half-open ranges. Do **not** use
`'[]'` (closed) — that would reject the valid back-to-back 10:00–11:00 booking.

### Verbatim: booking service — build the range, let the DB reject overlaps

Hibernate 6 supports Postgres range types, but the cleanest hackathon path is to
build the `tstzrange` in SQL and catch the constraint violation:

```java
@Service
public class BookingService {

    private final BookingRepository bookings;
    private final AssetRepository assets;
    private final NotificationService notifications;

    @Transactional
    public Booking book(BookRequest req, Long actingEmployeeId) {
        Asset resource = assets.findById(req.resourceId()).orElseThrow(NotFoundException::new);
        if (!resource.isBookable())
            throw new NotBookableException(resource.getAssetTag());
        if (!req.start().isBefore(req.end()))
            throw new InvalidSlotException("start must be before end");

        try {
            // Insert with an explicit tstzrange; the exclusion constraint does the overlap check.
            Long id = bookings.insertBooking(
                req.resourceId(), actingEmployeeId,
                req.onBehalfOfDepartmentId(),
                req.start(), req.end());          // native insert builds tstzrange(?, ?)
            Booking b = bookings.findById(id).orElseThrow();
            notifications.bookingConfirmed(b);
            return b;
        } catch (DataIntegrityViolationException ex) {
            // The exclusion constraint fired → an overlapping booking exists.
            if (isExclusionViolation(ex, "no_overlapping_bookings")) {
                throw new BookingOverlapException(resource.getAssetTag(), req.start(), req.end());
                //  -> API maps to 409 { message: "slot overlaps an existing booking" }
            }
            throw ex;
        }
    }
}
```

Native insert (the `tstzrange(?, ?)` is the key — `'[)'` bounds by default):

```java
public interface BookingRepository extends JpaRepository<Booking, Long> {
    @Modifying
    @Query(value = """
        INSERT INTO bookings (resource_id, booked_by, on_behalf_of_department_id, during, status)
        VALUES (:resourceId, :bookedBy, :deptId, tstzrange(:start, :end, '[)'), 'UPCOMING')
        RETURNING id
        """, nativeQuery = true)
    Long insertBooking(Long resourceId, Long bookedBy, Long deptId, Instant start, Instant end);
}
```

> **The whole point:** you never write a "check for overlaps" query with a race
> window between check and insert. The DB rejects the overlapping row atomically.
> Two users submitting overlapping slots for Room B2 at the same instant → exactly
> one succeeds, the other gets a clean 409. Demo this with two concurrent requests.

### Booking status lifecycle & operations

`UPCOMING → ONGOING → COMPLETED`, or `→ CANCELLED`. Cancel/reschedule:

- **Cancel**: set `status='CANCELLED'`. Because the exclusion constraint has
  `WHERE status IN ('UPCOMING','ONGOING')`, a cancelled booking immediately stops
  blocking that slot — someone else can now book it. That's the desired behaviour and
  it's automatic.
- **Reschedule**: cancel + create new (simplest), or update the `during` range (the
  exclusion constraint re-checks on UPDATE too). Cancel+recreate is cleaner to reason
  about.
- `UPCOMING → ONGOING → COMPLETED` transitions can be driven by the scheduled job
  (Part 3) comparing `now()` to the range bounds, or computed on read. Computing on
  read (a booking "is ongoing" if `during @> now()`) avoids a job; persist the status
  only if you need to query by it. For the hackathon, compute-on-read is fine, or a
  light cron flip.

### Calendar view (read)

`GET /api/bookings?resourceId=&from=&to=` returns the resource's bookings in a window
for the calendar. Overlap-free by construction, so the calendar just renders them.

Endpoints:

| Method | Path                          | Auth                                   | Notes                          |
|--------|-------------------------------|----------------------------------------|--------------------------------|
| POST   | `/api/bookings`               | any authenticated (self); DEPT_HEAD for dept | create; 409 on overlap    |
| GET    | `/api/bookings`               | any authenticated                      | calendar feed (filter by resource/window) |
| PATCH  | `/api/bookings/{id}/cancel`   | booker / manager                       | frees the slot                 |
| PATCH  | `/api/bookings/{id}/reschedule`| booker / manager                       | cancel+recreate or update range |

---

## Part 3 — Overdue flagging (feeds dashboard + notifications)

Allocations past `expected_return_at` while still `ACTIVE` are overdue. Surface them
separately from upcoming returns (the dashboard highlights overdue distinctly).

Two ways, both fine:

- **Compute-on-read** (no job): overdue = `status='ACTIVE' AND expected_return_at <
  now()`. The dashboard KPI query and notifications list use this predicate directly.
  Simplest, no moving parts, always correct.
- **Scheduled job** (the "cron job if time" from the kickoff): a `@Scheduled` sweep
  that finds newly-overdue allocations and *emits notifications* (compute-on-read
  can't push a notification the moment something tips overdue). Use the job **only**
  for the push-notification side; keep the dashboard predicate compute-on-read.

Verbatim scheduled sweep (guard against the `@Async`/self-invocation trap from
Faraday — the sweep calls the notification bean, a *separate* bean, so the proxy is
intact):

```java
@Component
public class OverdueSweepJob {

    private final AllocationRepository allocations;
    private final NotificationService notifications;   // separate bean — proxy intact

    // every 5 min in the hackathon; tune with cron expression
    @Scheduled(fixedDelay = 300_000)
    public void flagOverdue() {
        Instant now = Instant.now();
        for (Allocation a : allocations.findNewlyOverdue(now)) {
            notifications.overdueReturn(a);            // "Overdue Return Alert"
            allocations.markOverdueNotified(a.getId());// so we don't re-notify every sweep
        }
    }
}
```

(Add an `overdue_notified_at TIMESTAMPTZ` column to `allocations` if you take the job
route, so each overdue allocation is announced once.)

Enable scheduling with `@EnableScheduling` on a config class. The same job class is
the natural home for booking reminders ("reminder before the slot starts") and the
`UPCOMING → ONGOING → COMPLETED` flips if you choose the persisted-status route.

---

## Definition of done

- **Prove it under concurrency** (this is the demo): two simultaneous allocation
  requests for the same asset → exactly one succeeds, the other gets a 409 with
  `currentHolder` + transfer offer. Two simultaneous overlapping booking requests for
  the same resource → exactly one succeeds, the other gets a 409 overlap error.
- The partial unique index and the GiST exclusion constraint both exist in the DB and
  are the actual enforcement (temporarily disabling the app-level checks must NOT
  allow a double-allocation or overlap — the DB still refuses).
- Boundary behaviour matches the spec exactly: 09:00–10:00 booked → 09:30–10:30
  rejected, 10:00–11:00 accepted.
- Transfer workflow moves the active allocation atomically (never two ACTIVE rows).
- Return captures condition + notes and reverts the asset to AVAILABLE.
- Overdue allocations are flagged and drive both the dashboard (compute-on-read) and
  a one-time notification (job).
