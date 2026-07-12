import { api } from "./client";
import { qs } from "@/lib/utils";
import type { MaintPriority, MaintStatus, MaintenanceRequest } from "./types";

export const maintenance = {
  list: (params: { asset?: number; status?: MaintStatus } = {}) =>
    api.get<MaintenanceRequest[]>(`/api/maintenance${qs(params)}`),

  raise: (body: { assetId: number; issue: string; priority: MaintPriority; photoUrl?: string | null }) =>
    api.post<MaintenanceRequest>("/api/maintenance", body),

  approve: (id: number) => api.patch<MaintenanceRequest>(`/api/maintenance/${id}/approve`),
  reject: (id: number) => api.patch<MaintenanceRequest>(`/api/maintenance/${id}/reject`),
  assign: (id: number, technicianId: number) =>
    api.patch<MaintenanceRequest>(`/api/maintenance/${id}/assign`, { technicianId }),
  start: (id: number) => api.patch<MaintenanceRequest>(`/api/maintenance/${id}/start`),
  resolve: (id: number, notes: string) => api.patch<MaintenanceRequest>(`/api/maintenance/${id}/resolve`, { notes }),
};
