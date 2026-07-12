// Tiny in-page event bus: mock mutations emit events so the notification bell
// updates "live", standing in for the real SSE stream.

type Handler = () => void;

class MockBus {
  private handlers = new Map<string, Set<Handler>>();

  subscribe(event: string, fn: Handler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return () => this.handlers.get(event)?.delete(fn);
  }

  emit(event: string): void {
    this.handlers.get(event)?.forEach((fn) => {
      try {
        fn();
      } catch {
        /* listener errors shouldn't break emitters */
      }
    });
  }
}

export const mockBus = new MockBus();
