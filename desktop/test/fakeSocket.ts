/**
 * Minimal WebSocket stand-in.
 *
 * Only what WebchannelClient touches: the four handlers, `send`, `close`,
 * `readyState`, and the constructor's URL. Installed over the global so the
 * client under test is unmodified for testing.
 */
export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Every socket constructed since the last `reset()`, oldest first. */
  static instances: FakeSocket[] = [];

  static reset(): void {
    FakeSocket.instances = [];
  }

  static get last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (socket === undefined) throw new Error("no socket was constructed");
    return socket;
  }

  readyState: number = FakeSocket.CONNECTING;
  sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
  }

  // ── test-side drivers ────────────────────────────────────────────────────

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Deliver a raw string, for malformed-frame cases. */
  deliverRaw(data: unknown): void {
    this.onmessage?.({ data });
  }

  drop(code = 1006, reason = "connection lost"): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  /** Frames this socket sent, parsed. */
  frames(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }
}

export function installFakeSocket(): void {
  FakeSocket.reset();
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeSocket;
}
