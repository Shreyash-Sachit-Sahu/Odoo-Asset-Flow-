package com.example.assetflowlogin.dashboard;

import com.example.assetflowlogin.common.RoleScope;
import com.example.assetflowlogin.common.SimpleTtlCache;
import org.springframework.stereotype.Service;

import java.time.Duration;

@Service
public class DashboardService {

    private final DashboardRepository repo;      // runs the aggregate queries
    private final SimpleTtlCache cache;

    private static final Duration TTL = Duration.ofSeconds(30);
    private static final String KEY_PREFIX = "kpis:";

    public DashboardService(DashboardRepository repo, SimpleTtlCache cache) {
        this.repo = repo;
        this.cache = cache;
    }

    public DashboardKpis kpisFor(RoleScope scope) {
        String key = KEY_PREFIX + scope.cacheKey();     // scope = role + dept for scoped views
        DashboardKpis cached = cache.get(key);
        if (cached != null) return cached;

        DashboardKpis fresh = repo.computeKpis(scope);   // the aggregate queries above
        cache.put(key, fresh, TTL);
        return fresh;
    }

    // Called (via DashboardStateChangeEvent) by allocation/booking/maintenance
    // services after a state change.
    public void invalidate() {
        cache.evictByPrefix(KEY_PREFIX);
    }
}
