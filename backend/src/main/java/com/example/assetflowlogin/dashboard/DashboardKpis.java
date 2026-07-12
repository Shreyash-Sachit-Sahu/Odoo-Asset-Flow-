package com.example.assetflowlogin.dashboard;

import java.util.List;

/**
 * The KPI card bundle for the dashboard screen: Assets Available, Assets
 * Allocated, Maintenance Today, Active Bookings, Pending Transfers, Upcoming
 * Returns — plus Overdue Returns highlighted separately from upcoming ones.
 */
public record DashboardKpis(
        long assetsAvailable,
        long assetsAllocated,
        long maintenanceToday,
        long activeBookings,
        long pendingTransfers,
        long upcomingReturns,
        long overdueReturns,
        List<OverdueAllocation> overdueList
) {

    public record OverdueAllocation(
            long allocationId,
            long assetId,
            String assetTag,
            long employeeId,
            String employeeName,
            java.time.OffsetDateTime expectedReturnAt
    ) {}
}
