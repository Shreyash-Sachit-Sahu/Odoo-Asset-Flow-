import { api } from "./client";
import { qs } from "@/lib/utils";
import type { Asset, AssetCondition, AssetHistoryEvent, AssetStatus, Page } from "./types";

export interface AssetFilters {
  tag?: string;
  serial?: string;
  category?: number;
  status?: AssetStatus;
  department?: number;
  location?: string;
  bookable?: boolean;
  q?: string;
  page?: number;
  size?: number;
  sort?: string; // "field,asc|desc" (Spring Pageable)
}

export interface RegisterAssetBody {
  name: string;
  categoryId: number;
  serialNumber?: string | null;
  acquisitionDate?: string | null;
  acquisitionCost?: number | null;
  condition: AssetCondition;
  location?: string | null;
  isBookable: boolean;
  customValues: Record<string, string | number | boolean>;
  photoUrl?: string | null;
}

export const assets = {
  list: (filters: AssetFilters = {}) => api.get<Page<Asset>>(`/api/assets${qs({ ...filters })}`),
  get: (id: number) => api.get<Asset>(`/api/assets/${id}`),
  history: (id: number) => api.get<AssetHistoryEvent[]>(`/api/assets/${id}/history`),
  register: (body: RegisterAssetBody) => api.post<Asset>("/api/assets", body),
  update: (id: number, body: Partial<RegisterAssetBody>) => api.put<Asset>(`/api/assets/${id}`, body),
  retire: (id: number) => api.patch<Asset>(`/api/assets/${id}/retire`),
  dispose: (id: number) => api.patch<Asset>(`/api/assets/${id}/dispose`),
};
