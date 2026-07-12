package com.example.assetflowlogin.dashboard;

import org.springframework.context.ApplicationEvent;

/**
 * Publish this from allocation/booking/maintenance/transfer services after
 * any state transition that changes a KPI number (allocate/return/book/
 * cancel/approve/resolve):
 *
 *   applicationEventPublisher.publishEvent(new DashboardStateChangeEvent(this));
 *
 * Keeps those services decoupled from DashboardService directly.
 */
public class DashboardStateChangeEvent extends ApplicationEvent {
    public DashboardStateChangeEvent(Object source) {
        super(source);
    }
}
