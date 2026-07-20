import type { PublishEvent, PublishEventType } from "./types";

// Event bus — the publishing layer is event-driven. Every lifecycle transition emits a
// PublishEvent; subscribers (history, dashboards, the future Learning Engine) react.
// Deterministic and synchronous: an in-memory append-only log plus subscribers.

export type EventHandler = (e: PublishEvent) => void;

export class EventBus {
  private log: PublishEvent[] = [];
  private handlers = new Set<EventHandler>();

  emit(e: PublishEvent): PublishEvent {
    this.log.push(e);
    for (const h of this.handlers) h(e);
    return e;
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** The full append-only event log (optionally filtered by asset). */
  events(assetKey?: string): PublishEvent[] {
    return assetKey ? this.log.filter((e) => e.assetKey === assetKey) : [...this.log];
  }

  /** Count of each event type — for dashboards. */
  counts(): Partial<Record<PublishEventType, number>> {
    const out: Partial<Record<PublishEventType, number>> = {};
    for (const e of this.log) out[e.type] = (out[e.type] ?? 0) + 1;
    return out;
  }

  clear(): void {
    this.log = [];
  }
}
