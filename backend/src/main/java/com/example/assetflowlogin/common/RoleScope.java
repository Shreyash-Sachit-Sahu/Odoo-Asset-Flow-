package com.example.assetflowlogin.common;

/**
 * Scope derived from the caller's JWT: their role plus (optionally) the
 * department they're restricted to. Used to build cache keys and to
 * parameterise the dashboard aggregate queries by role scope.
 *
 * ADMIN / ASSET_MANAGER typically see org-wide numbers (departmentId == null).
 * A department-scoped manager or employee gets departmentId set, and every
 * aggregate query is filtered by it.
 */
public record RoleScope(Long employeeId, String role, Long departmentId) {

    public boolean isOrgWide() {
        return departmentId == null || "ADMIN".equals(role) || "ASSET_MANAGER".equals(role);
    }

    /** Stable string used as the cache key suffix — same scope must produce the same key. */
    public String cacheKey() {
        return isOrgWide() ? role + ":ALL" : role + ":DEPT:" + departmentId;
    }
}
