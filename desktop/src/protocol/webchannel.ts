/**
 * webchannel_v1 — typed mirror of `spec/webchannel_v1.json`.
 *
 * This file is the contract with the Zig core (`src/channels/web.zig`). If the
 * spec's version bumps or an event gains a field, change it here in the same
 * commit — a stale type here is a bug exactly like a stale doc.
 */

export const WEBCHANNEL_VERSION = 1 as const;

export type UiToCore = "pairing_request" | "user_message" | "approval_response" | "error";
export type CoreToUi =
  | "pairing_result"
  | "assistant_chunk"
  | "assistant_final"
  | "tool_call"
  | "tool_result"
  | "approval_request"
  | "error";
export type EventName = UiToCore | CoreToUi;

/** Envelope for an inline-encrypted field (x25519-chacha20poly1305-v1). */
export interface E2ePayload {
  alg?: string;
  nonce: string;
  ciphertext: string;
}

export interface PairingRequestPayload {
  /** Required for relay transport; optional on a loopback local transport. */
  pairing_code?: string;
  client_pub?: string;
  client_public_key?: string;
}

export interface PairingResultPayload {
  ok: boolean;
  client_id: string;
  access_token: string;
  token_type: string;
  expires_in: number;
  set_cookie?: string;
  e2e_required: boolean;
  e2e?: { alg?: string; agent_pub?: string };
}

export interface UserMessagePayload {
  /** Required unless `e2e` is used. */
  content?: string;
  sender_id?: string;
  access_token?: string;
  auth_token?: string;
  e2e?: E2ePayload;
}

/** `assistant_chunk` and `assistant_final` share a shape. */
export interface AssistantTextPayload {
  content?: string;
  e2e?: E2ePayload;
}

export interface ToolCallPayload {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResultPayload {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ApprovalRequestPayload {
  action: string;
  reason?: string;
}

export interface ApprovalResponsePayload {
  approved: boolean;
  reason?: string;
}

export interface ErrorPayload {
  code?: string;
  message: string;
}

export interface PayloadMap {
  pairing_request: PairingRequestPayload;
  pairing_result: PairingResultPayload;
  user_message: UserMessagePayload;
  assistant_chunk: AssistantTextPayload;
  assistant_final: AssistantTextPayload;
  tool_call: ToolCallPayload;
  tool_result: ToolResultPayload;
  approval_request: ApprovalRequestPayload;
  approval_response: ApprovalResponsePayload;
  error: ErrorPayload;
}

export type PayloadFor<T extends EventName> = T extends keyof PayloadMap ? PayloadMap[T] : never;

/** Every frame on the wire is this envelope. `v`, `type`, `session_id` required. */
export interface Envelope<T extends EventName = EventName> {
  v: typeof WEBCHANNEL_VERSION;
  type: T;
  session_id: string;
  agent_id?: string;
  request_id?: string;
  payload?: PayloadFor<T>;
  /** UI JWT, pairing/relay mode. May also be nested in the payload. */
  access_token?: string;
  /** Channel token, local `message_auth_mode=token`. */
  auth_token?: string;
}

/**
 * Narrowing parse for an inbound frame. The core is trusted less than our own
 * types: anything failing these checks is dropped rather than rendered.
 */
export function parseEnvelope(raw: string): Envelope | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const frame = value as Record<string, unknown>;
  if (frame.v !== WEBCHANNEL_VERSION) return null;
  if (typeof frame.type !== "string") return null;
  if (typeof frame.session_id !== "string") return null;
  return frame as unknown as Envelope;
}

export function isCoreToUi(type: string): type is CoreToUi {
  return (
    type === "pairing_result" ||
    type === "assistant_chunk" ||
    type === "assistant_final" ||
    type === "tool_call" ||
    type === "tool_result" ||
    type === "approval_request" ||
    type === "error"
  );
}
