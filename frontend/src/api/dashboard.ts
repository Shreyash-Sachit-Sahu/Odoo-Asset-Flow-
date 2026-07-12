import { api } from "./client";
import type { DashboardData } from "./types";

export const dashboard = {
  get: () => api.get<DashboardData>("/api/dashboard"),
};
