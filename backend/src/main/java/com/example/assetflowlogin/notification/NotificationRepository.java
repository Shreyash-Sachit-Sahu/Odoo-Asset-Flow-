package com.example.assetflowlogin.notification;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface NotificationRepository extends JpaRepository<Notification, Long> {

    @Query("SELECT n FROM Notification n WHERE n.recipientId = :recipientId " +
           "ORDER BY n.isRead ASC, n.createdAt DESC")
    List<Notification> findForRecipientUnreadFirst(@Param("recipientId") Long recipientId);
}
