package com.example.assetflowlogin.activity;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;

public interface ActivityLogRepository extends JpaRepository<ActivityLog, Long> {

    @Query("SELECT a FROM ActivityLog a WHERE " +
           "(:actorId IS NULL OR a.actorId = :actorId) AND " +
           "(:entityType IS NULL OR a.entityType = :entityType) AND " +
           "(:from IS NULL OR a.createdAt >= :from) AND " +
           "(:to IS NULL OR a.createdAt <= :to) " +
           "ORDER BY a.createdAt DESC")
    List<ActivityLog> search(@Param("actorId") Long actorId,
                              @Param("entityType") String entityType,
                              @Param("from") OffsetDateTime from,
                              @Param("to") OffsetDateTime to);
}
