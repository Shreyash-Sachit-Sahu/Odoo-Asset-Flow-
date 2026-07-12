package com.example.assetflowlogin.common;

import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Minimal in-memory TTL cache — same role Redis would have played in
 * DashboardService, without the extra infra dependency. Good enough for a
 * single-instance deployment; if you later scale to multiple app instances
 * behind a load balancer, swap this back for Redis (StringRedisTemplate)
 * since an in-memory cache won't be shared/invalidated across instances.
 */
@Component
public class SimpleTtlCache {

    private record Entry<T>(T value, Instant expiresAt) {}

    private final Map<String, Entry<Object>> store = new ConcurrentHashMap<>();

    @SuppressWarnings("unchecked")
    public <T> T get(String key) {
        Entry<Object> entry = store.get(key);
        if (entry == null) return null;
        if (Instant.now().isAfter(entry.expiresAt())) {
            store.remove(key);
            return null;
        }
        return (T) entry.value();
    }

    public void put(String key, Object value, Duration ttl) {
        store.put(key, new Entry<>(value, Instant.now().plus(ttl)));
    }

    public void evictByPrefix(String prefix) {
        store.keySet().removeIf(k -> k.startsWith(prefix));
    }
}
