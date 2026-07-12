package com.example.assetflowlogin.dashboard;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class DashboardCacheInvalidationListener {

    private final DashboardService dashboardService;

    public DashboardCacheInvalidationListener(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    @EventListener
    public void onStateChange(DashboardStateChangeEvent event) {
        dashboardService.invalidate();
    }
}
