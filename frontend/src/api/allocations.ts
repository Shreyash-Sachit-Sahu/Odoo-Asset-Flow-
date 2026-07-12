import { api } from "./client";
import { qs } from "@/lib/utils";
import type { Allocation, AllocationStatus, AssetCondition, TransferRequest, TransferStatus } from "./types";

export const allocations = {
  list: (params: { status?: AllocationStatus; assetId?: number; holder?: number; mine?: boolean } = {}) =>
    api.get<Allocation[]>(`/api/allocations${qs(params)}`),

  // 409 → ApiError.body is AllocationConflictBody ({ currentHolder, canRequestTransfer })
  allocate: (body: {
    assetId: number;
    holderEmployeeId?: number | null;
    holderDepartmentId?: number | null;
    expectedReturnAt?: string | null;
  }) => api.post<Allocation>("/api/allocations", body),

  return: (allocationId: number, body: { condition: AssetCondition; notes?: string }) =>
    api.patch<Allocation>(`/api/allocations/${allocationId}/return`, body),
};

export const transfers = {
  list: (params: { status?: TransferStatus; mine?: boolean } = {}) =>
    api.get<TransferRequest[]>(`/api/transfer-requests${qs(params)}`),

  create: (body: {
    assetId: number;
    toEmployeeId?: number | null;
    toDepartmentId?: number | null;
    reason?: string;
  }) => api.post<TransferRequest>("/api/transfer-requests", body),

  approve: (id: number) => api.patch<TransferRequest>(`/api/transfer-requests/${id}/approve`),
  reject: (id: number) => api.patch<TransferRequest>(`/api/transfer-requests/${id}/reject`),
};
