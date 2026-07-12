# Phase 2 — Master Data (Organization Setup) + RBAC Enforcement

## Objective

The master data everything else depends on: departments (with hierarchy), asset
categories (with optional category-specific fields), and the employee directory —
including the **only** place roles are assigned: Admin promoting an Employee to
Department Head or Asset Manager. This is Screen 3 (Admin-only, three tabs).

Mostly CRUD, so this brief specifies schema + endpoint contracts + the RBAC matrix,
and gives verbatim code only for the two things worth getting right: the
department-hierarchy cycle guard and the role-promotion endpoint (security-sensitive).

## Depends on

Phase 1 (auth + offline JWT validation + `@PreAuthorize` primitives; `employees`
table created here is written to by Phase 1 signup — land this migration first if
building strictly in order).

## Parallelizable

✅ Track A. Once this lands, Phase 3 (assets) can start against real categories.

---

## Schema (Flyway migration in `core-service`)

`V2__master_data.sql` (or `V3__` if auth ordering pushed it):

```sql
CREATE TABLE departments (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name                VARCHAR(120) NOT NULL,
    parent_department_id BIGINT REFERENCES departments(id),  -- hierarchy, nullable
    head_employee_id    BIGINT,                              -- FK added after employees exists
    status              VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (name)
);

CREATE TABLE asset_categories (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name          VARCHAR(120) NOT NULL UNIQUE,
    -- optional category-specific fields as a schema definition, e.g.
    -- {"warrantyPeriodMonths":"number","voltage":"string"}; asset rows fill values.
    custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE employees (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    name          VARCHAR(120) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    department_id BIGINT REFERENCES departments(id),
    status        VARCHAR(10) NOT NULL DEFAULT 'ACTIVE'
                    CHECK (status IN ('ACTIVE','INACTIVE')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Now that employees exists, wire the department head FK:
ALTER TABLE departments
    ADD CONSTRAINT fk_dept_head FOREIGN KEY (head_employee_id) REFERENCES employees(id);

CREATE INDEX idx_employees_department ON employees(department_id);
CREATE INDEX idx_departments_parent  ON departments(parent_department_id);
```

> **Role lives on `users.role`, not `employees`.** The directory *displays* the role
> by joining `employees → users`, and promotion writes `users.role`. Keeping one
> column as the authz source of truth (read by the JWT issuer in Phase 1) means
> there is exactly one place the role can be. Do not duplicate a role column onto
> `employees`.

---

## Tab A — Department Management

Create / edit / deactivate. Assign a head, optional parent (hierarchy), status.

Endpoints (all `@PreAuthorize("hasRole('ADMIN')")`):

| Method | Path                         | Notes                                    |
|--------|------------------------------|------------------------------------------|
| POST   | `/api/departments`           | create                                   |
| PUT    | `/api/departments/{id}`      | edit name/head/parent/status             |
| PATCH  | `/api/departments/{id}/status`| activate / deactivate                    |
| GET    | `/api/departments`           | list (tree or flat); readable by managers|
| GET    | `/api/departments/{id}`      | detail                                   |

### Verbatim: hierarchy cycle guard

A department cannot be its own ancestor, or you get an infinite tree (and infinite
loops in any recursive query). Guard on assign/edit of `parent_department_id`:

```java
@Transactional
public void setParent(Long deptId, Long newParentId) {
    if (newParentId == null) { /* ok, becomes a root */ return; }
    if (newParentId.equals(deptId)) {
        throw new InvalidHierarchyException("A department cannot be its own parent");
    }
    // Walk up from the proposed parent; if we reach deptId, it's a cycle.
    Long cursor = newParentId;
    int guard = 0;
    while (cursor != null) {
        if (cursor.equals(deptId)) {
            throw new InvalidHierarchyException("Cyclic department hierarchy");
        }
        if (++guard > 1000) throw new InvalidHierarchyException("Hierarchy too deep");
        cursor = departments.findParentId(cursor).orElse(null);
    }
    departments.updateParent(deptId, newParentId);
}
```

Deactivating a department: decide the rule and state it in the UI. Sensible default —
block deactivation while it has active employees or allocated assets, or cascade to
"inactive" with a warning. For the hackathon, **block with a clear message** is
simplest and safest.

---

## Tab B — Asset Category Management

Create / edit categories (Electronics, Furniture, Vehicles, …) with optional
category-specific field *definitions* stored in `custom_fields` (JSONB). Asset rows
(Phase 3) store the *values* against those definitions.

Endpoints (`@PreAuthorize("hasRole('ADMIN')")` for writes; managers can read):

| Method | Path                       | Notes                                  |
|--------|----------------------------|----------------------------------------|
| POST   | `/api/categories`          | create; `custom_fields` schema optional|
| PUT    | `/api/categories/{id}`     | edit                                   |
| PATCH  | `/api/categories/{id}/status`| active/inactive                        |
| GET    | `/api/categories`          | list                                   |

Keep `custom_fields` as a simple `{fieldName: type}` map (type ∈ string/number/date/
boolean). Phase 3 validates asset custom values against it loosely — full JSON-schema
validation is out of scope for the hackathon.

---

## Tab C — Employee Directory + role promotion (the security-critical bit)

Directory: name, email, department, role (displayed), status. **This is the only
place roles are assigned.**

Endpoints:

| Method | Path                            | Auth                          | Notes                          |
|--------|---------------------------------|-------------------------------|--------------------------------|
| GET    | `/api/employees`                | ADMIN (full) / managers (scoped)| directory list + search        |
| GET    | `/api/employees/{id}`           | ADMIN / self / dept head       | detail                         |
| PATCH  | `/api/employees/{id}/department`| ADMIN                          | reassign department            |
| PATCH  | `/api/employees/{id}/status`    | ADMIN                          | active/inactive                |
| PATCH  | `/api/employees/{id}/role`      | **ADMIN only**                 | promote/demote — see below     |

### Verbatim: role promotion endpoint

Writes `users.role`. Admin-only. Cannot be reached by any self-service path. Note the
guard against demoting the last admin (so you can't lock everyone out) and the audit
log write (Phase 6 provides the logger; call it here).

```java
public record RoleChangeRequest(
    @NotNull Role newRole    // EMPLOYEE | DEPARTMENT_HEAD | ASSET_MANAGER | ADMIN
) {}

@RestController
@RequestMapping("/api/employees")
public class EmployeeRoleController {

    private final RoleService roleService;

    @PatchMapping("/{employeeId}/role")
    @PreAuthorize("hasRole('ADMIN')")          // the ONLY writer of elevated roles
    public ResponseEntity<Void> changeRole(@PathVariable Long employeeId,
                                           @Valid @RequestBody RoleChangeRequest req,
                                           @AuthenticationPrincipal AppUser actingAdmin) {
        roleService.changeRole(employeeId, req.newRole(), actingAdmin.getId());
        return ResponseEntity.noContent().build();
    }
}

@Service
public class RoleService {

    private final EmployeeRepository employees;
    private final UserRepository users;
    private final ActivityLogService activityLog;   // Phase 6

    @Transactional
    public void changeRole(Long employeeId, Role newRole, Long actingAdminId) {
        Employee emp = employees.findById(employeeId).orElseThrow(NotFoundException::new);
        User target = users.findById(emp.getUserId()).orElseThrow(NotFoundException::new);

        // Don't allow removing the last remaining ADMIN.
        if (target.getRole() == Role.ADMIN && newRole != Role.ADMIN
                && users.countByRole(Role.ADMIN) <= 1) {
            throw new LastAdminException("Cannot demote the only remaining admin");
        }

        Role previous = target.getRole();
        target.setRole(newRole);
        users.save(target);

        activityLog.record(actingAdminId, "ROLE_CHANGE",
            "employee", employeeId,
            "role %s -> %s".formatted(previous, newRole));
    }
}
```

Because the JWT carries the role, a promoted user's **new role takes effect on their
next token** (next login or refresh). Note this in the UI ("changes apply on next
sign-in"), or force a re-login. For the hackathon, next-refresh is fine.

---

## RBAC matrix (enforce; source = problem statement)

| Capability                                   | ADMIN | ASSET_MANAGER | DEPT_HEAD | EMPLOYEE |
|----------------------------------------------|:-----:|:-------------:|:---------:|:--------:|
| Org setup (depts, categories, directory)     |  ✅   |       —       |     —     |    —     |
| Assign/promote roles                         |  ✅   |       —       |     —     |    —     |
| Create audit cycles                          |  ✅   |       —       |     —     |    —     |
| Org-wide analytics                           |  ✅   |       —       |     —     |    —     |
| Register assets                              |  ✅   |      ✅       |     —     |    —     |
| Allocate assets                              |  ✅   |      ✅       |     —     |    —     |
| Approve transfers / maintenance / returns    |  ✅   |      ✅       |  scoped¹  |    —     |
| Approve audit discrepancy resolution         |  ✅   |      ✅       |     —     |    —     |
| View dept's allocated assets                 |  ✅   |      ✅       |    ✅     |    —     |
| Book shared resources (for dept)             |  ✅   |      ✅       |    ✅     |    —     |
| Book shared resources (self)                 |  ✅   |      ✅       |    ✅     |    ✅    |
| View own allocated assets                    |  ✅   |      ✅       |    ✅     |    ✅    |
| Raise maintenance request                    |  ✅   |      ✅       |    ✅     |    ✅    |
| Initiate return / transfer request           |  ✅   |      ✅       |    ✅     |    ✅    |

¹ Department Head approves allocation/transfer requests **within their own
department** only — enforce the scope check (the request's department must match the
head's `department_id`), not just the role.

---

## Definition of done

- Admin can CRUD departments, assign a head + optional parent; a cyclic parent is
  rejected with a clear error.
- Admin can CRUD categories with optional custom-field definitions.
- Directory lists employees with their (joined) role; **only** the Admin role-change
  endpoint can elevate a role, and it's unreachable by any employee token (403).
- Demoting the last remaining admin is blocked.
- A role change is written to `users.role` and recorded in the activity log; it
  takes effect on the user's next token.
- Department Head endpoints enforce department *scope*, not just the role.
