import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WebchannelClient,
  type ConnectionState,
} from "../transport/WebchannelClient.js";
import type { DesktopSettings } from "../bridge.js";

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

let counter = 0;
const nextId = (): string => `t${(counter += 1)}`;

/**
 * Session state for one conversation.
 *
 * The backend is authoritative for everything here — this is a cache of a
 * stream, not a source of truth. A settings change re-homes the socket.
 */
export function useSession(settings: DesktopSettings | null, sessionId: string) {
  const [items, setItems] = useState<TranscriptItem[]>([]);
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle" });
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const clientRef = useRef<WebchannelClient | null>(null);
  // Streaming chunks append into the open assistant turn rather than pushing a
  // new item per chunk.
  const streamingId = useRef<string | null>(null);

  useEffect(() => {
    if (settings === null) return;

    const client = new WebchannelClient(
      {
        url: settings.wsUrl,
        sessionId,
        authMode: settings.authMode,
        ...(settings.authToken === undefined ? {} : { authToken: settings.authToken }),
      },
      {
        onState: setConnection,

        onChunk: (payload) => {
          const text = payload.content ?? "";
          if (text.length === 0) return;
          setItems((prev) => {
            const openId = streamingId.current;
            if (openId !== null) {
              return prev.map((item) =>
                item.kind === "assistant" && item.id === openId
                  ? { ...item, text: item.text + text }
                  : item,
              );
            }
            const id = nextId();
            streamingId.current = id;
            return [...prev, { kind: "assistant", id, text, streaming: true }];
          });
        },

        onFinal: (payload) => {
          const text = payload.content ?? "";
          setItems((prev) => {
            const openId = streamingId.current;
            streamingId.current = null;
            if (openId !== null) {
              // `assistant_final` carries the whole message; prefer it over the
              // accumulated chunks so a dropped chunk cannot corrupt the turn.
              return prev.map((item) =>
                item.kind === "assistant" && item.id === openId
                  ? { ...item, text: text.length > 0 ? text : item.text, streaming: false }
                  : item,
              );
            }
            return [...prev, { kind: "assistant", id: nextId(), text, streaming: false }];
          });
        },

        onToolCall: (payload) => {
          setItems((prev) => [
            ...prev,
            { kind: "tool-call", id: nextId(), name: payload.name, args: payload.arguments },
          ]);
        },

        onToolResult: (payload) => {
          setItems((prev) => [
            ...prev,
            {
              kind: "tool-result",
              id: nextId(),
              ok: payload.ok,
              ...(payload.result === undefined ? {} : { result: payload.result }),
              ...(payload.error === undefined ? {} : { error: payload.error }),
            },
          ]);
        },

        onApprovalRequest: (payload, requestId) => {
          setApproval({
            id: nextId(),
            action: payload.action,
            ...(payload.reason === undefined ? {} : { reason: payload.reason }),
            ...(requestId === undefined ? {} : { requestId }),
          });
        },

        onError: (payload) => {
          setItems((prev) => [
            ...prev,
            {
              kind: "error",
              id: nextId(),
              ...(payload.code === undefined ? {} : { code: payload.code }),
              message: payload.message,
            },
          ]);
        },
      },
    );

    clientRef.current = client;
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
      streamingId.current = null;
    };
  }, [settings, sessionId]);

  const send = useCallback((text: string) => {
    const client = clientRef.current;
    if (client === null) return;
    setItems((prev) => [...prev, { kind: "user", id: nextId(), text }]);
    try {
      client.send(text);
    } catch (err) {
      setItems((prev) => [
        ...prev,
        {
          kind: "error",
          id: nextId(),
          message: err instanceof Error ? err.message : "send failed",
        },
      ]);
    }
  }, []);

  const resolveApproval = useCallback(
    (approved: boolean, reason?: string) => {
      const client = clientRef.current;
      const pending = approval;
      setApproval(null);
      if (client === null || pending === null) return;
      client.respondToApproval(approved, reason, pending.requestId);
    },
    [approval],
  );

  const canSend = useMemo(() => connection.status === "ready", [connection]);

  return { items, connection, approval, send, resolveApproval, canSend };
}
