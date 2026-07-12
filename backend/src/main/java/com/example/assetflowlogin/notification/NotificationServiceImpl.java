package com.example.assetflowlogin.notification;

import org.springframework.stereotype.Service;

/**
 * Synchronous in-app persistence — simplest correct option. Kept as its own
 * bean rather than a method called from within another bean, so if you
 * later mark notify() @Async, callers going through this bean's Spring
 * proxy will actually run it asynchronously (self-invocation from within
 * the same class would silently run synchronously instead).
 */
@Service
public class NotificationServiceImpl implements NotificationService {

    private final NotificationRepository repository;

    public NotificationServiceImpl(NotificationRepository repository) {
        this.repository = repository;
    }

    @Override
    public void notify(Long recipientId, NotificationType type, String message, String refType, Long refId) {
        Notification notification = new Notification(recipientId, type, message, refType, refId);
        repository.save(notification);
    }
}
