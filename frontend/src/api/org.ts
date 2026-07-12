import { api } from "./client";
import { qs } from "@/lib/utils";
import type { Category, CustomFieldType, Department, Employee, Role } from "./types";

export const departments = {
  list: () => api.get<Department[]>("/api/departments"),
  get: (id: number) => api.get<Department>(`/api/departments/${id}`),
  create: (body: { name: string; parentDepartmentId?: number | null; headEmployeeId?: number | null }) =>
    api.post<Department>("/api/departments", body),
  update: (
    id: number,
    body: { name?: string; parentDepartmentId?: number | null; headEmployeeId?: number | null },
  ) => api.put<Department>(`/api/departments/${id}`, body),
  setStatus: (id: number, status: "ACTIVE" | "INACTIVE") =>
    api.patch<Department>(`/api/departments/${id}/status`, { status }),
};

export const categories = {
  list: () => api.get<Category[]>("/api/categories"),
  create: (body: { name: string; customFields?: Record<string, CustomFieldType> }) =>
    api.post<Category>("/api/categories", body),
  update: (id: number, body: { name?: string; customFields?: Record<string, CustomFieldType> }) =>
    api.put<Category>(`/api/categories/${id}`, body),
  setStatus: (id: number, isActive: boolean) => api.patch<Category>(`/api/categories/${id}/status`, { isActive }),
};

export const employees = {
  list: (params: { q?: string; department?: number; role?: Role } = {}) =>
    api.get<Employee[]>(`/api/employees${qs(params)}`),
  get: (id: number) => api.get<Employee>(`/api/employees/${id}`),
  setDepartment: (id: number, departmentId: number | null) =>
    api.patch<Employee>(`/api/employees/${id}/department`, { departmentId }),
  setStatus: (id: number, status: "ACTIVE" | "INACTIVE") =>
    api.patch<Employee>(`/api/employees/${id}/status`, { status }),
  // The ONLY place roles change (ADMIN-only server-side).
  setRole: (id: number, newRole: Role) => api.patch<void>(`/api/employees/${id}/role`, { newRole }),
};
