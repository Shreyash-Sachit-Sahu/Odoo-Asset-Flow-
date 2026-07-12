package com.example.assetflowlogin.notification;

import jakarta.persistence.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "notifications")
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "recipient_id", nullable = false)
    private Long recipientId;

    @Column(nullable = false, length = 40)
    private String type;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String message;

    @Column(name = "ref_type", length = 30)
    private String refType;

    @Column(name = "ref_id")
    private Long refId;

    @Column(name = "is_read", nullable = false)
    private boolean isRead = false;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    protected Notification() {}

    public Notification(Long recipientId, NotificationType type, String message, String refType, Long refId) {
        this.recipientId = recipientId;
        this.type = type.name();
        this.message = message;
        this.refType = refType;
        this.refId = refId;
    }

    public Long getId() { return id; }
    public Long getRecipientId() { return recipientId; }
    public String getType() { return type; }
    public String getMessage() { return message; }
    public String getRefType() { return refType; }
    public Long getRefId() { return refId; }
    public boolean isRead() { return isRead; }
    public OffsetDateTime getCreatedAt() { return createdAt; }

    public void markRead() { this.isRead = true; }
}
