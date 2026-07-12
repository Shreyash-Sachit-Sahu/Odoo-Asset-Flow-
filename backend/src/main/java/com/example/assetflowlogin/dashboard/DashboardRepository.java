package com.example.assetflowlogin.dashboard;

import com.example.assetflowlogin.common.RoleScope;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/**
 * Runs the cheap aggregate queries backing the KPI cards. Uses Spring Boot's
 * auto-configured JdbcTemplate against your single 'assetflow' datasource —
 * no separate read replica for now. If you outgrow this later, add a second
 * DataSource bean pointed at a replica and inject it here instead.
 *
 * NOTE: table/column names below (assets, maintenance_requests, bookings,
 * transfer_requests, allocations, employees) assume the domain model from
 * earlier phases of this project. Adjust to match your actual entities if
 * they differ.
 */
@Repository
public class DashboardRepository {

    private final JdbcTemplate jdbc;

    public DashboardRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public DashboardKpis computeKpis(RoleScope scope) {
        String deptFilter = scope.isOrgWide() ? "" : " AND department_id = ?";
        Object[] deptArg = scope.isOrgWide() ? new Object[]{} : new Object[]{scope.departmentId()};

        long assetsAvailable = count(
                "SELECT count(*) FROM assets WHERE status = 'AVAILABLE'" + deptFilter, deptArg);
        long assetsAllocated = count(
                "SELECT count(*) FROM assets WHERE status = 'ALLOCATED'" + deptFilter, deptArg);
        long maintenanceToday = count(
                "SELECT count(*) FROM maintenance_requests " +
                        "WHERE status IN ('APPROVED','TECHNICIAN_ASSIGNED','IN_PROGRESS') " +
                        "AND created_at::date = current_date" + deptFilter, deptArg);
        long activeBookings = count(
                "SELECT count(*) FROM bookings WHERE status IN ('UPCOMING','ONGOING')" + deptFilter, deptArg);
        long pendingTransfers = count(
                "SELECT count(*) FROM transfer_requests WHERE status = 'REQUESTED'" + deptFilter, deptArg);
        long upcomingReturns = count(
                "SELECT count(*) FROM allocations " +
                        "WHERE status = 'ACTIVE' AND expected_return_at BETWEEN now() AND now() + interval '7 days'"
                        + deptFilter, deptArg);
        long overdueReturns = count(
                "SELECT count(*) FROM allocations " +
                        "WHERE status = 'ACTIVE' AND expected_return_at < now()" + deptFilter, deptArg);

        List<DashboardKpis.OverdueAllocation> overdueList = jdbc.query(
                "SELECT a.id, a.asset_id, ast.tag, a.employee_id, e.name, a.expected_return_at " +
                        "FROM allocations a " +
                        "JOIN assets ast ON ast.id = a.asset_id " +
                        "JOIN employees e ON e.id = a.employee_id " +
                        "WHERE a.status = 'ACTIVE' AND a.expected_return_at < now()" + deptFilter +
                        " ORDER BY a.expected_return_at ASC LIMIT 50",
                deptArg,
                (rs, rowNum) -> new DashboardKpis.OverdueAllocation(
                        rs.getLong("id"),
                        rs.getLong("asset_id"),
                        rs.getString("tag"),
                        rs.getLong("employee_id"),
                        rs.getString("name"),
                        rs.getObject("expected_return_at", java.time.OffsetDateTime.class)
                ));

        return new DashboardKpis(
                assetsAvailable, assetsAllocated, maintenanceToday, activeBookings,
                pendingTransfers, upcomingReturns, overdueReturns, overdueList);
    }

    private long count(String sql, Object[] args) {
        Long result = jdbc.queryForObject(sql, args, Long.class);
        return result == null ? 0L : result;
    }
}
