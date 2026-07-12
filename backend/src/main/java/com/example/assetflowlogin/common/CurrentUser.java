package com.example.assetflowlogin.common;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;

/**
 * Resolves the calling employee's id/role/department out of the Spring
 * Security Authentication your existing JWT filter already populates.
 *
 * NOTE: adjust extractClaim()/auth.getName() below to match however your
 * JwtService actually puts claims onto the Authentication object (e.g. if
 * you're using a custom UserPrincipal instead of raw claims in getDetails()).
 */
public final class CurrentUser {

    private CurrentUser() {}

    public static RoleScope scopeOf(Authentication auth) {
        Long employeeId = Long.valueOf(auth.getName()); // subject == user id
        String role = auth.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .findFirst()
                .orElse("EMPLOYEE")
                .replaceFirst("^ROLE_", "");
        Long departmentId = extractClaim(auth, "departmentId");
        return new RoleScope(employeeId, role, departmentId);
    }

    private static Long extractClaim(Authentication auth, String claim) {
        if (auth.getDetails() instanceof java.util.Map<?, ?> details) {
            Object val = details.get(claim);
            if (val != null) return Long.valueOf(val.toString());
        }
        return null;
    }
}
