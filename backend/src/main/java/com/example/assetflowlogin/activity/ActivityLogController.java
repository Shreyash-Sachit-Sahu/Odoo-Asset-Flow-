package com.example.assetflowlogin.activity;

import com.example.assetflowlogin.common.CurrentUser;
import com.example.assetflowlogin.common.RoleScope;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/activity")
public class ActivityLogController {

    private final ActivityLogRepository repository;

    public ActivityLogController(ActivityLogRepository repository) {
        this.repository = repository;
    }

    // GET /api/activity?actor=&entity=&from=&to=  (ADMIN; managers scoped)
    @GetMapping
    @PreAuthorize("hasAnyRole('ADMIN','ASSET_MANAGER')")
    public List<ActivityLog> search(
            Authentication auth,
            @RequestParam(name = "actor", required = false) Long actorParam,
            @RequestParam(name = "entity", required = false) String entityType,
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) @RequestParam(required = false) OffsetDateTime from,
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME) @RequestParam(required = false) OffsetDateTime to) {

        RoleScope scope = CurrentUser.scopeOf(auth);
        Long actorId = actorParam;
        if (!"ADMIN".equals(scope.role())) {
            actorId = (actorParam == null) ? scope.employeeId() : actorParam;
            if (!actorId.equals(scope.employeeId()) && !scope.isOrgWide()) {
                actorId = scope.employeeId(); // non-admin can't page through other actors
            }
        }
        return repository.search(actorId, entityType, from, to);
    }
}
