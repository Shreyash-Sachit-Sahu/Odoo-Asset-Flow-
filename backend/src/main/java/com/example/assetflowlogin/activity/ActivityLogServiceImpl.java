package com.example.assetflowlogin.activity;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ActivityLogServiceImpl implements ActivityLogService {

    private final ActivityLogRepository repository;

    public ActivityLogServiceImpl(ActivityLogRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional // default propagation: joins the caller's transaction, rolls back with it
    public void record(Long actorId, ActivityAction action, String entityType, Long entityId, String detail) {
        repository.save(new ActivityLog(actorId, action, entityType, entityId, detail));
    }

    @Override
    @Transactional(propagation = Propagation.REQUIRES_NEW) // commits independently, even on caller rollback
    public void recordIndependent(Long actorId, ActivityAction action, String entityType, Long entityId, String detail) {
        repository.save(new ActivityLog(actorId, action, entityType, entityId, detail));
    }
}
