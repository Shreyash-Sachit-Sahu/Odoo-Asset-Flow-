package com.example.assetflowlogin.activity;

public interface ActivityLogService {

    /**
     * Logs in the caller's current transaction. If the business transaction
     * rolls back, this row rolls back with it — correct for a "successful
     * actions only" audit trail, which is the default here.
     */
    void record(Long actorId, ActivityAction action, String entityType, Long entityId, String detail);

    /**
     * Logs in a REQUIRES_NEW transaction that commits independently of the
     * caller's transaction — use when you want the attempt recorded even if
     * the surrounding business transaction fails/rolls back.
     */
    void recordIndependent(Long actorId, ActivityAction action, String entityType, Long entityId, String detail);
}
