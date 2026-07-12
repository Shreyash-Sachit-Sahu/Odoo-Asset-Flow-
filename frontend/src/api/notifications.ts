import { api, MOCKS_ENABLED, getAccessToken } from "./client";
import type { NotificationItem } from "./types";

export const notifications = {
  list: () => api.get<NotificationItem[]>("/api/notifications"),
  markRead: (id: number) => api.patch<NotificationItem>(`/api/notifications/${id}/read`),
};

/**
 * Live push. Real mode: SSE via the gateway (`/api/notifications/stream`), token
 * as a query param since EventSource can't set headers; callers should keep a
 * polling fallback active regardless. Mock mode: an in-page event bus fired by
 * mock mutations. Returns an unsubscribe fn.
 */
export function subscribeToNotifications(onEvent: () => void): () => void {
  if (MOCKS_ENABLED) {
    let unsub: (() => void) | null = null;
    let cancelled = false;
    import("./mock/bus").then(({ mockBus }) => {
      if (cancelled) return;
      unsub = mockBus.subscribe("notification", onEvent);
    });
    return () => {
      cancelled = true;
      unsub?.();
    };
  }

  const base = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";
  const token = getAccessToken();
  let source: EventSource | null = null;
  try {
    source = new EventSource(`${base}/api/notifications/stream${token ? `?token=${token}` : ""}`);
    source.onmessage = () => onEvent();
    source.onerror = () => {
      // Leave polling (caller-side refetchInterval) to carry it.
      source?.close();
      source = null;
    };
  } catch {
    source = null;
  }
  return () => source?.close();
}
