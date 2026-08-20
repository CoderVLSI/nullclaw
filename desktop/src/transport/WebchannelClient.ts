import {
  WEBCHANNEL_VERSION,
  parseEnvelope,
  type ApprovalRequestPayload,
  type AssistantTextPayload,
  type EventName,
  type Envelope,
  type ErrorPayload,
  type PairingResultPayload,
  type PayloadFor,
  type ToolCallPayload,
  type ToolResultPayload,
} from "../protocol/webchannel.js";

export type AuthMode = "pairing" | "token";

export interface WebchannelOptions {
  /** e.g. `ws://127.0.0.1:32123/ws` — matches WebConfig defaults. */
  url: string;
  sessionId: string;
  agentId?: string;
  /** Mirrors `WebConfig.message_auth_mode`. Default `pairing`, per the Zig default. */
  authMode?: AuthMode;
  /** Channel token for `authMode="token"`, and for the WS upgrade in either mode. */
  authToken?: string;
  /** One-time code printed by the relay. Optional on loopback local transport. */
  pairingCode?: string;
  /** Attempts before giving up. Bounded — never an infinite spinner. */
  maxRetries?: number;
}

export type ConnectionState =
  | { status: "idle" }
  | { status: "connecting"; attempt: number }
  | { status: "pairing" }
  | { status: "ready"; clientId?: string }
  | { status: "reconnecting"; attempt: number; nextRetryMs: number }
  | { status: "failed"; reason: string };

export interface WebchannelHandlers {
  onState?(state: ConnectionState): void;
  onChunk?(payload: AssistantTextPayload): void;
  onFinal?(payload: AssistantTextPayload): void;
  onToolCall?(payload: ToolCallPayload): void;
  onToolResult?(payload: ToolResultPayload): void;
  onApprovalRequest?(payload: ApprovalRequestPayload, requestId?: string): void;
  onError?(payload: ErrorPayload): void;
}

const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 15_000;

/**
 * webchannel_v1 client.
 *
 * Owns exactly one socket and the credential ladder behind it. Deliberately
 * free of any React or Electron import: the same class backs the packaged app,
 * a browser tab, and a test harness.
 */
export class WebchannelClient {
  private socket: WebSocket | null = null;
  private state: ConnectionState = { status: "idle" };
  private accessToken: string | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;

  constructor(
    private readonly options: WebchannelOptions,
    private readonly handlers: WebchannelHandlers = {},
  ) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  connect(): void {
    this.closedByUs = false;
    this.openSocket();
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    this.setState({ status: "idle" });
  }

  /**
   * `user_message`. In pairing mode this requires the JWT minted by
   * `pairing_result`; sending before that resolves is a programming error, so
   * it throws rather than silently dropping the turn.
   */
  send(content: string, senderId?: string): void {
    const authMode = this.options.authMode ?? "pairing";
    if (authMode === "pairing" && this.accessToken === null) {
      throw new Error("webchannel: cannot send before pairing completes");
    }
    this.dispatch("user_message", {
      content,
      ...(senderId === undefined ? {} : { sender_id: senderId }),
      ...(authMode === "pairing"
        ? { access_token: this.accessToken ?? undefined }
        : { auth_token: this.options.authToken }),
    });
  }

  /** Answer an `approval_request`. `requestId` correlates it to the ask. */
  respondToApproval(approved: boolean, reason?: string, requestId?: string): void {
    this.dispatch(
      "approval_response",
      { approved, ...(reason === undefined ? {} : { reason }) },
      requestId,
    );
  }

  // ── internals ────────────────────────────────────────────────────────────

  private openSocket(): void {
    this.setState({ status: "connecting", attempt: this.attempt });

    // The upgrade token rides in the query string because a browser WebSocket
    // cannot set an Authorization header. web.zig accepts either.
    const url = new URL(this.options.url);
    if (this.options.authToken !== undefined) {
      url.searchParams.set("token", this.options.authToken);
    }

    let socket: WebSocket;
    try {
      socket = new WebSocket(url.toString());
    } catch (err) {
      this.scheduleRetry(err instanceof Error ? err.message : "socket construction failed");
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      if ((this.options.authMode ?? "pairing") === "pairing") {
        this.setState({ status: "pairing" });
        this.dispatch("pairing_request", {
          ...(this.options.pairingCode === undefined
            ? {}
            : { pairing_code: this.options.pairingCode }),
        });
      } else {
        this.setState({ status: "ready" });
      }
    };

    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      const frame = parseEnvelope(event.data);
      if (frame === null) return;
      this.handleFrame(frame);
    };

    socket.onerror = () => {
      // `onclose` always follows; retry is scheduled there so it happens once.
    };

    socket.onclose = (event: CloseEvent) => {
      this.socket = null;
      if (this.closedByUs) return;
      this.accessToken = null;
      this.scheduleRetry(event.reason || `socket closed (${event.code})`);
    };
  }

  private handleFrame(frame: Envelope): void {
    switch (frame.type) {
      case "pairing_result": {
        const payload = frame.payload as PairingResultPayload | undefined;
        if (payload === undefined || payload.ok !== true) {
          this.setState({ status: "failed", reason: "pairing rejected" });
          this.closedByUs = true;
          this.socket?.close();
          return;
        }
        this.accessToken = payload.access_token;
        this.setState({ status: "ready", clientId: payload.client_id });
        return;
      }
      case "assistant_chunk":
        this.handlers.onChunk?.(frame.payload as AssistantTextPayload);
        return;
      case "assistant_final":
        this.handlers.onFinal?.(frame.payload as AssistantTextPayload);
        return;
      case "tool_call":
        this.handlers.onToolCall?.(frame.payload as ToolCallPayload);
        return;
      case "tool_result":
        this.handlers.onToolResult?.(frame.payload as ToolResultPayload);
        return;
      case "approval_request":
        this.handlers.onApprovalRequest?.(
          frame.payload as ApprovalRequestPayload,
          frame.request_id,
        );
        return;
      case "error":
        this.handlers.onError?.(frame.payload as ErrorPayload);
        return;
      default:
        return;
    }
  }

  private dispatch<T extends EventName>(
    type: T,
    payload: PayloadFor<T>,
    requestId?: string,
  ): void {
    const socket = this.socket;
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      throw new Error(`webchannel: cannot send ${type} while disconnected`);
    }
    const envelope: Envelope<T> = {
      v: WEBCHANNEL_VERSION,
      type,
      session_id: this.options.sessionId,
      ...(this.options.agentId === undefined ? {} : { agent_id: this.options.agentId }),
      ...(requestId === undefined ? {} : { request_id: requestId }),
      payload,
    };
    socket.send(JSON.stringify(envelope));
  }

  /** Bounded exponential backoff, ending in a real failure the UI can act on. */
  private scheduleRetry(reason: string): void {
    const maxRetries = this.options.maxRetries ?? 6;
    if (this.attempt >= maxRetries) {
      this.setState({ status: "failed", reason });
      return;
    }
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempt, MAX_BACKOFF_MS);
    this.attempt += 1;
    this.setState({ status: "reconnecting", attempt: this.attempt, nextRetryMs: delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.openSocket();
    }, delay);
  }

  private setState(next: ConnectionState): void {
    this.state = next;
    this.handlers.onState?.(next);
  }
}
