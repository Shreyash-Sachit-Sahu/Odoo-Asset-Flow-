import { api } from "./client";
import type { AuditCycle, AuditItem, AuditResult } from "./types";

export const audits = {
  list: () => api.get<AuditCycle[]>("/api/audits"),
  get: (id: number) => api.get<AuditCycle>(`/api/audits/${id}`),

  create: (body: {
    name: string;
    scopeDepartmentId?: number | null;
    scopeLocation?: string | null;
    startDate: string;
    endDate: string;
  }) => api.post<AuditCycle>("/api/audits", body),

  assignAuditors: (id: number, auditorIds: number[]) =>
    api.post<AuditCycle>(`/api/audits/${id}/auditors`, { auditorIds }),

  items: (id: number) => api.get<AuditItem[]>(`/api/audits/${id}/items`),

  mark: (cycleId: number, assetId: number, body: { result: AuditResult; notes?: string }) =>
    api.patch<AuditItem>(`/api/audits/${cycleId}/items/${assetId}`, body),

  discrepancies: (id: number) => api.get<AuditItem[]>(`/api/audits/${id}/discrepancies`),

  close: (id: number) => api.patch<AuditCycle>(`/api/audits/${id}/close`),
};
