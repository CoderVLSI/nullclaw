import type {
  ApprovalRequestPayload,
  AssistantTextPayload,
  ErrorPayload,
  ToolCallPayload,
  ToolResultPayload,
} from "../protocol/webchannel.js";

export type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; streaming: boolean }
  | { kind: "tool-call"; id: string; name: string; args: Record<string, unknown> }
  | { kind: "tool-result"; id: string; ok: boolean; result?: unknown; error?: string }
  | { kind: "error"; id: string; code?: string; message: string };

export interface PendingApproval {
  id: string;
  action: string;
  reason?: string;
  requestId?: string;
}

export interface TranscriptState {
  items: TranscriptItem[];
  /** Id of the assistant turn currently accumulating chunks, if any. */
  streamingId: string | null;
  approval: PendingApproval | null;
  /** Monotonic id source. Kept in state so the reducer stays pure. */
  seq: number;
}

export const initialTranscript: TranscriptState = {
  items: [],
  streamingId: null,
  approval: null,
  seq: 0,
};

export type TranscriptAction =
  | { type: "user"; text: string }
  | { type: "chunk"; payload: AssistantTextPayload }
  | { type: "final"; payload: AssistantTextPayload }
  | { type: "tool-call"; payload: ToolCallPayload }
  | { type: "tool-result"; payload: ToolResultPayload }
  | { type: "approval-request"; payload: ApprovalRequestPayload; requestId?: string }
  | { type: "approval-clear" }
  | { type: "error"; payload: ErrorPayload }
  | { type: "reset" };

/**
 * Pure reconciliation of the core's event stream into a renderable transcript.
 *
 * Kept free of React so the streaming rules — the part that would visibly
 * corrupt a conversation if wrong — are testable directly.
 */
export function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction,
): TranscriptState {
  const nextId = (seq: number): string => `t${seq}`;

  switch (action.type) {
    case "reset":
      return initialTranscript;

    case "user": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [...state.items, { kind: "user", id: nextId(seq), text: action.text }],
      };
    }

    case "chunk": {
      const text = action.payload.content ?? "";
      // An empty chunk is a keepalive, not a turn: it must not open one.
      if (text.length === 0) return state;

      if (state.streamingId !== null) {
        const openId = state.streamingId;
        return {
          ...state,
          items: state.items.map((item) =>
            item.kind === "assistant" && item.id === openId
              ? { ...item, text: item.text + text }
              : item,
          ),
        };
      }
      const seq = state.seq + 1;
      const id = nextId(seq);
      return {
        ...state,
        seq,
        streamingId: id,
        items: [...state.items, { kind: "assistant", id, text, streaming: true }],
      };
    }

    case "final": {
      const text = action.payload.content ?? "";
      if (state.streamingId !== null) {
        const openId = state.streamingId;
        return {
          ...state,
          streamingId: null,
          // `assistant_final` carries the whole message, so prefer it over the
          // accumulated chunks: a dropped chunk cannot corrupt the turn. An
          // empty final is a terminator only — keep what streamed.
          items: state.items.map((item) =>
            item.kind === "assistant" && item.id === openId
              ? { ...item, text: text.length > 0 ? text : item.text, streaming: false }
              : item,
          ),
        };
      }
      // A final with no preceding chunk is a complete, non-streamed reply.
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [...state.items, { kind: "assistant", id: nextId(seq), text, streaming: false }],
      };
    }

    case "tool-call": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        // A tool call interrupts the open turn: later chunks belong to a new
        // assistant message, not to text that preceded the call.
        streamingId: null,
        items: [
          ...state.items.map((item) =>
            item.kind === "assistant" && item.id === state.streamingId
              ? { ...item, streaming: false }
              : item,
          ),
          {
            kind: "tool-call",
            id: nextId(seq),
            name: action.payload.name,
            args: action.payload.arguments,
          },
        ],
      };
    }

    case "tool-result": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [
          ...state.items,
          {
            kind: "tool-result",
            id: nextId(seq),
            ok: action.payload.ok,
            ...(action.payload.result === undefined ? {} : { result: action.payload.result }),
            ...(action.payload.error === undefined ? {} : { error: action.payload.error }),
          },
        ],
      };
    }

    case "approval-request": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        approval: {
          id: nextId(seq),
          action: action.payload.action,
          ...(action.payload.reason === undefined ? {} : { reason: action.payload.reason }),
          ...(action.requestId === undefined ? {} : { requestId: action.requestId }),
        },
      };
    }

    case "approval-clear":
      return { ...state, approval: null };

    case "error": {
      const seq = state.seq + 1;
      return {
        ...state,
        seq,
        items: [
          ...state.items,
          {
            kind: "error",
            id: nextId(seq),
            ...(action.payload.code === undefined ? {} : { code: action.payload.code }),
            message: action.payload.message,
          },
        ],
      };
    }
  }
}
