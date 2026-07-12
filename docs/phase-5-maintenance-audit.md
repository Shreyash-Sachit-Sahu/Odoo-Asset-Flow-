# Phase 5 — Maintenance & Audit Workflows

## Objective

Two structured workflows that both hang off the asset state machine:

- **Maintenance** (Screen 7): route repairs through approval *before* work starts;
  asset auto-flips to `UNDER_MAINTENANCE` on approval and back to `AVAILABLE` on
  resolution.
- **Audit** (Screen 8): run verification *cycles* (not a single form) with assigned
  auditors, auto-generated discrepancy reports, and cycle closure that updates
  affected asset statuses (e.g. confirmed-missing → `LOST`).

Both are workflow + status-transition logic. Verbatim code is reserved for the state
transitions (which must route through Phase 3's `transition()`) and the cycle-close
logic (which mutates many assets in one committed unit).

## Depends on

Phase 3 (asset state machine, history), Phase 2 (employees/departments for auditor
assignment + approvers), Phase 1 (RBAC). Independent of Phase 4.

## Parallelizable

✅ Track C — runs alongside the Phase 4 concurrency work.

---

## Part 1 — Maintenance Management

Workflow (spec): `Pending → Approved / Rejected (by Asset Manager) → Technician
Assigned → In Progress → Resolved`. Asset status auto-updates on approval and
resolution.

### Schema

`V7__maintenance.sql`:

```sql
CREATE TABLE maintenance_requests (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    asset_id     BIGINT NOT NULL REFERENCES assets(id),
    raised_by    BIGINT NOT NULL REFERENCES employees(id),
    issue        TEXT NOT NULL,
    priority     VARCHAR(10) NOT NULL DEFAULT 'MEDIUM'
                   CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
    photo_url    VARCHAR(512),
    status       VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','APPROVED','REJECTED',
                                     'TECHNICIAN_ASSIGNED','IN_PROGRESS','RESOLVED')),
    approved_by  BIGINT REFERENCES employees(id),
    technician_id BIGINT REFERENCES employees(id),
    resolution_notes TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    approved_at  TIMESTAMPTZ,
    resolved_at  TIMESTAMPTZ
);
CREATE INDEX idx_maint_asset  ON maintenance_requests(asset_id);
CREATE INDEX idx_maint_status ON maintenance_requests(status);
```

### The workflow state machine (request-level) + asset side effects

Request transitions and the **asset** transitions they trigger:

| Request event         | Request: from → to                    | Asset side effect (via `transition()`)      | Who              |
|-----------------------|---------------------------------------|---------------------------------------------|------------------|
| raise                 | — → PENDING                           | none                                        | holder/any       |
| approve               | PENDING → APPROVED                    | `START_MAINTENANCE` → `UNDER_MAINTENANCE`   | ASSET_MANAGER/ADMIN |
| reject                | PENDING → REJECTED                    | none                                        | ASSET_MANAGER/ADMIN |
| assign technician     | APPROVED → TECHNICIAN_ASSIGNED        | none                                        | ASSET_MANAGER/ADMIN |
| start work            | TECHNICIAN_ASSIGNED → IN_PROGRESS     | none                                        | technician/AM    |
| resolve               | IN_PROGRESS → RESOLVED                | `RESOLVE_MAINTENANCE` → `AVAILABLE`         | ASSET_MANAGER/ADMIN |

> **Approval gates the asset flip — deliberately.** The asset only becomes
> `UNDER_MAINTENANCE` on *approval*, never on the mere raising of a request. That's
> the spec's "must be approved before work begins and before the asset flips." Don't
> flip on raise.

Verbatim (approval + resolution — the two that move asset state):

```java
@Service
public class MaintenanceService {

    private final MaintenanceRepository requests;
    private final AssetRepository assets;
    private final AssetLifecycleService lifecycle;   // Phase 3
    private final AssetHistoryService history;
    private final NotificationService notifications; // Phase 6

    @Transactional
    public void approve(Long requestId, Long approverId) {
        MaintenanceRequest r = requests.findById(requestId).orElseThrow(NotFoundException::new);
        if (r.getStatus() != MaintenanceStatus.PENDING)
            throw new IllegalWorkflowStateException(r.getStatus());

        Asset asset = assets.findByIdForUpdate(r.getAssetId()).orElseThrow(NotFoundException::new);

        r.setStatus(MaintenanceStatus.APPROVED);
        r.setApprovedBy(approverId);
        r.setApprovedAt(Instant.now());
        requests.save(r);

        lifecycle.transition(asset, AssetEvent.START_MAINTENANCE);  // -> UNDER_MAINTENANCE
        history.record(asset.getId(), "MAINT_APPROVED", r.getIssue(), approverId);
        notifications.maintenanceApproved(r);
    }

    @Transactional
    public void resolve(Long requestId, String notes, Long actorId) {
        MaintenanceRequest r = requests.findById(requestId).orElseThrow(NotFoundException::new);
        if (r.getStatus() != MaintenanceStatus.IN_PROGRESS)
            throw new IllegalWorkflowStateException(r.getStatus());

        Asset asset = assets.findByIdForUpdate(r.getAssetId()).orElseThrow(NotFoundException::new);

        r.setStatus(MaintenanceStatus.RESOLVED);
        r.setResolutionNotes(notes);
        r.setResolvedAt(Instant.now());
        requests.save(r);

        lifecycle.transition(asset, AssetEvent.RESOLVE_MAINTENANCE);  // -> AVAILABLE
        history.record(asset.getId(), "MAINT_RESOLVED", notes, actorId);
        notifications.maintenanceResolved(r);
    }
}
```

Edge case worth handling: can you approve maintenance on an `ALLOCATED` asset? The
Phase 3 state machine allows `ALLOCATED → UNDER_MAINTENANCE`, and the spec's flow has
the *holder* raising the request — so yes. On resolution it returns to `AVAILABLE`
(the allocation was effectively ended by taking it for repair). If you want to
preserve the allocation across maintenance, that's extra scope — for the hackathon,
resolve → AVAILABLE is the clean default; note it in the UI.

Endpoints (`/api/maintenance`):

| Method | Path                                    | Auth                     |
|--------|-----------------------------------------|--------------------------|
| POST   | `/api/maintenance`                      | any authenticated (raise)|
| PATCH  | `/api/maintenance/{id}/approve`         | ASSET_MANAGER, ADMIN     |
| PATCH  | `/api/maintenance/{id}/reject`          | ASSET_MANAGER, ADMIN     |
| PATCH  | `/api/maintenance/{id}/assign`          | ASSET_MANAGER, ADMIN     |
| PATCH  | `/api/maintenance/{id}/start`           | technician, ASSET_MANAGER|
| PATCH  | `/api/maintenance/{id}/resolve`         | ASSET_MANAGER, ADMIN     |
| GET    | `/api/maintenance?asset=&status=`       | any authenticated        |

Maintenance history per asset is the `asset_history` feed filtered to `MAINT_*`
events, so no extra table needed.

---

## Part 2 — Asset Audit (verification cycles)

Spec: create an Audit Cycle (scope: department/location, date range) → assign
auditors → auditors mark each asset Verified / Missing / Damaged → auto-generate a
discrepancy report → close cycle (locks it, updates affected asset statuses) →
history retained per cycle.

### Schema

`V8__audit.sql`:

```sql
CREATE TABLE audit_cycles (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          VARCHAR(160) NOT NULL,
    scope_department_id BIGINT REFERENCES departments(id),
    scope_location VARCHAR(160),
    start_date    DATE NOT NULL,
    end_date      DATE NOT NULL,
    status        VARCHAR(10) NOT NULL DEFAULT 'OPEN'
                   CHECK (status IN ('OPEN','CLOSED')),
    created_by    BIGINT NOT NULL REFERENCES employees(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    closed_at     TIMESTAMPTZ,
    CONSTRAINT valid_dates CHECK (start_date <= end_date)
);

CREATE TABLE audit_cycle_auditors (
    cycle_id    BIGINT NOT NULL REFERENCES audit_cycles(id),
    auditor_id  BIGINT NOT NULL REFERENCES employees(id),
    PRIMARY KEY (cycle_id, auditor_id)
);

CREATE TABLE audit_items (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cycle_id    BIGINT NOT NULL REFERENCES audit_cycles(id),
    asset_id    BIGINT NOT NULL REFERENCES assets(id),
    result      VARCHAR(10) CHECK (result IN ('VERIFIED','MISSING','DAMAGED')),  -- null = not yet checked
    auditor_id  BIGINT REFERENCES employees(id),
    notes       TEXT,
    checked_at  TIMESTAMPTZ,
    UNIQUE (cycle_id, asset_id)     -- one row per asset per cycle
);
CREATE INDEX idx_audit_items_cycle ON audit_items(cycle_id);
```

### Cycle creation → populate the scope

When Admin creates a cycle, snapshot the in-scope assets into `audit_items` (one row
per asset, `result` null = pending). "In scope" = assets matching
`scope_department_id` and/or `scope_location`. This freezes what auditors must check.

```java
@Transactional
public AuditCycle createCycle(CreateCycleRequest req, Long adminId) {
    AuditCycle cycle = /* save from req */;
    List<Long> assetIds = assets.findIdsInScope(req.departmentId(), req.location());
    auditItems.bulkInsertPending(cycle.getId(), assetIds);   // INSERT ... SELECT
    return cycle;
}
```

Auditor marking (auditor must be assigned to the cycle; cycle must be OPEN):

```java
@Transactional
public void mark(Long cycleId, Long assetId, AuditResult result, String notes, Long auditorId) {
    AuditCycle cycle = cycles.findById(cycleId).orElseThrow(NotFoundException::new);
    if (cycle.getStatus() == CycleStatus.CLOSED)
        throw new CycleLockedException();              // closed cycles are immutable
    if (!auditors.isAssigned(cycleId, auditorId))
        throw new NotAssignedAuditorException();
    AuditItem item = auditItems.findByCycleAndAsset(cycleId, assetId).orElseThrow(NotFoundException::new);
    item.setResult(result);
    item.setAuditorId(auditorId);
    item.setNotes(notes);
    item.setCheckedAt(Instant.now());
    auditItems.save(item);
}
```

### Discrepancy report (auto-generated)

Not a stored artifact you have to build up front — it's a **query** over `audit_items`
for the cycle where `result IN ('MISSING','DAMAGED')`. Expose it as an endpoint; the
frontend renders it, and the reports service (Phase 6) can export it. Auto-generated =
always reflects current marks, no manual assembly.

```
GET /api/audits/{cycleId}/discrepancies
  -> items where result in (MISSING, DAMAGED), with asset tag/name, auditor, notes
```

### Verbatim: close cycle — lock + update affected asset statuses

Closing is the consequential action: it locks the cycle (no more edits) and applies
status changes to flagged assets. Confirmed-missing → `LOST` (a real state-machine
transition); damaged → optionally raise a maintenance request or set condition. Do it
in one transaction so the cycle-lock and all asset updates commit together.

```java
@Transactional
public void closeCycle(Long cycleId, Long adminId) {
    AuditCycle cycle = cycles.findByIdForUpdate(cycleId).orElseThrow(NotFoundException::new);
    if (cycle.getStatus() == CycleStatus.CLOSED)
        throw new CycleAlreadyClosedException();

    for (AuditItem item : auditItems.findByCycle(cycleId)) {
        if (item.getResult() == AuditResult.MISSING) {
            Asset asset = assets.findByIdForUpdate(item.getAssetId()).orElseThrow();
            // Only transition if the state machine permits (terminal states are skipped).
            if (canMarkLost(asset.getStatus())) {
                lifecycle.transition(asset, AssetEvent.MARK_LOST);   // -> LOST
                history.record(asset.getId(), "AUDIT_LOST",
                    "cycle " + cycleId, adminId);
                notifications.auditDiscrepancyFlagged(cycle, asset);
            }
        } else if (item.getResult() == AuditResult.DAMAGED) {
            Asset asset = assets.findById(item.getAssetId()).orElseThrow();
            asset.setCondition(AssetCondition.DAMAGED);   // condition, not lifecycle
            assets.save(asset);
            history.record(asset.getId(), "AUDIT_DAMAGED", "cycle " + cycleId, adminId);
            // Optional: auto-raise a maintenance request for damaged items.
        }
    }
    cycle.setStatus(CycleStatus.CLOSED);
    cycle.setClosedAt(Instant.now());
    cycles.save(cycle);
}
```

`canMarkLost` = status is one of AVAILABLE/ALLOCATED/RESERVED (per the Phase 3 table).
An asset already `DISPOSED`/`RETIRED` isn't transitioned — the loop skips it rather
than throwing, so one weird asset doesn't abort the whole close.

Endpoints (`/api/audits`):

| Method | Path                                         | Auth                          |
|--------|----------------------------------------------|-------------------------------|
| POST   | `/api/audits`                                | ADMIN (create cycle)          |
| POST   | `/api/audits/{id}/auditors`                  | ADMIN (assign auditors)       |
| GET    | `/api/audits/{id}/items`                     | assigned auditor, ADMIN       |
| PATCH  | `/api/audits/{id}/items/{assetId}`           | assigned auditor (mark)       |
| GET    | `/api/audits/{id}/discrepancies`             | ADMIN, ASSET_MANAGER          |
| PATCH  | `/api/audits/{id}/close`                     | ADMIN                         |
| GET    | `/api/audits`                                | ADMIN (list cycles + history) |

Approving audit *discrepancy resolution* (Asset Manager, per the roles list) can be a
lightweight follow-up: after close, an AM reviews each LOST/DAMAGED item and marks it
resolved (recovered → back to AVAILABLE, or confirmed → stays LOST / goes to repair).
Optional for the hackathon; the close itself is the required behaviour.

---

## Definition of done

- Raising a maintenance request does **not** change asset status; **approval** flips
  it to `UNDER_MAINTENANCE`; **resolution** flips it back to `AVAILABLE`. All via the
  Phase 3 state machine, never a direct status write.
- The maintenance workflow enforces its order (can't resolve a PENDING request, etc.).
- An audit cycle snapshots in-scope assets into `audit_items`; only assigned auditors
  can mark, and only while the cycle is OPEN.
- The discrepancy report is a live query over MISSING/DAMAGED items.
- Closing a cycle locks it (further marks rejected) and transitions confirmed-missing
  assets to `LOST` + sets damaged assets' condition, all in one transaction, skipping
  assets in terminal states rather than aborting.
- Every maintenance/audit action lands in `asset_history` and fires the right
  notification.
