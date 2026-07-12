package com.example.assetflowlogin.notification;

/**
 * Injected by every workflow service (role changes, allocations, bookings,
 * maintenance, transfers, audits) to fire a notification to the right
 * recipient. If those services are built before this one, scaffold this as
 * an interface with a no-op @Service bean so they compile; once
 * NotificationServiceImpl (below) is on the classpath, remove the stub so
 * Spring wires the real one — no caller code changes needed either way.
 */
public interface NotificationService {

    void notify(Long recipientId, NotificationType type, String message, String refType, Long refId);
}
