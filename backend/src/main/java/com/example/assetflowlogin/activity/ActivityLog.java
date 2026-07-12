package com.example.assetflowlogin.activity;

import jakarta.persistence.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "activity_log")
public class ActivityLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "actor_id")
    private Long actorId;

    @Column(nullable = false, length = 40)
    private String action;

    @Column(name = "entity_type", length = 30)
    private String entityType;

    @Column(name = "entity_id")
    private Long entityId;

    @Column(columnDefinition = "TEXT")
    private String detail;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    protected ActivityLog() {}

    public ActivityLog(Long actorId, ActivityAction action, String entityType, Long entityId, String detail) {
        this.actorId = actorId;
        this.action = action.name();
        this.entityType = entityType;
        this.entityId = entityId;
        this.detail = detail;
    }

    public Long getId() { return id; }
    public Long getActorId() { return actorId; }
    public String getAction() { return action; }
    public String getEntityType() { return entityType; }
    public Long getEntityId() { return entityId; }
    public String getDetail() { return detail; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
}
