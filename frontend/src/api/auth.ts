import { api } from "./client";
import type { SessionUser, TokenPair } from "./types";

export const auth = {
  login: (email: string, password: string) =>
    api.post<TokenPair>("/auth/login", { email, password }, { anonymous: true }),

  // Signup is Employee-only — there is deliberately no role field.
  signup: (body: { name: string; email: string; password: string; departmentId: number }) =>
    api.post<void>("/auth/signup", body, { anonymous: true }),

  refresh: (refresh: string) => api.post<TokenPair>("/auth/refresh", { refresh }, { anonymous: true }),

  logout: () => api.post<void>("/auth/logout"),

  me: () => api.get<SessionUser>("/auth/me"),

  forgot: (email: string) => api.post<{ resetToken?: string }>("/auth/forgot", { email }, { anonymous: true }),

  reset: (token: string, newPassword: string) =>
    api.post<void>("/auth/reset", { token, newPassword }, { anonymous: true }),
};
