import { api } from "./client";
import { qs } from "@/lib/utils";
import type { ActivityEntry } from "./types";

export const activity = {
  list: (params: { actor?: number; entity?: string; from?: string; to?: string } = {}) =>
    api.get<ActivityEntry[]>(`/api/activity${qs(params)}`),
};
