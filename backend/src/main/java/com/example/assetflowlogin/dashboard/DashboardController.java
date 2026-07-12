package com.example.assetflowlogin.dashboard;

import com.example.assetflowlogin.common.CurrentUser;
import com.example.assetflowlogin.common.RoleScope;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    /**
     * Returns the cached KPI bundle + overdue list, scoped to the caller's
     * role/department. Quick actions (Register Asset, Book Resource, Raise
     * Maintenance Request) are static shortcuts the frontend gates against
     * the RBAC matrix using the caller's role from the JWT — not returned here.
     */
    @GetMapping("/api/dashboard")
    public DashboardKpis dashboard(Authentication auth) {
        RoleScope scope = CurrentUser.scopeOf(auth);
        return dashboardService.kpisFor(scope);
    }
}
