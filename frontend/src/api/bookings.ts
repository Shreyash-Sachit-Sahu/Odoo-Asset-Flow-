import { api } from "./client";
import { qs } from "@/lib/utils";
import type { Booking } from "./types";

export const bookings = {
  list: (params: { resourceId?: number; from?: string; to?: string; mine?: boolean } = {}) =>
    api.get<Booking[]>(`/api/bookings${qs(params)}`),

  // 409 → ApiError.body is BookingConflictBody ({ message, conflict? })
  create: (body: { resourceId: number; start: string; end: string; onBehalfOfDepartmentId?: number | null }) =>
    api.post<Booking>("/api/bookings", body),

  cancel: (id: number) => api.patch<Booking>(`/api/bookings/${id}/cancel`),

  reschedule: (id: number, body: { start: string; end: string }) =>
    api.patch<Booking>(`/api/bookings/${id}/reschedule`, body),
};
