import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { WebchannelClient, type ConnectionState } from "../transport/WebchannelClient.js";
import {
  initialTranscript,
  transcriptReducer,
  type PendingApproval,
  type TranscriptItem,
} from "./transcript.js";
import type { DesktopSettings } from "../bridge.js";

export type { PendingApproval, TranscriptItem };

/**
 * Session state for one conversation.
 *
 * The backend is authoritative for everything here — this is a cache of a
 * stream, not a source of truth. A settings change re-homes the socket.
 * All reconciliation lives in `transcriptReducer`; this hook only wires the
 * socket to it.
 */
export function useSession(settings: DesktopSettings | null, sessionId: string) {
  const [state, dispatch] = useReducer(transcriptReducer, initialTranscript);
  const [connection, setConnection] = useState<ConnectionState>({ status: "idle" });
  const clientRef = useRef<WebchannelClient | null>(null);

  useEffect(() => {
    if (settings === null) return;

    dispatch({ type: "reset" });

    const client = new WebchannelClient(
      {
        url: settings.wsUrl,
        sessionId,
        authMode: settings.authMode,
        ...(settings.authToken === undefined ? {} : { authToken: settings.authToken }),
      },
      {
        onState: setConnection,
        onChunk: (payload) => dispatch({ type: "chunk", payload }),
        onFinal: (payload) => dispatch({ type: "final", payload }),
        onToolCall: (payload) => dispatch({ type: "tool-call", payload }),
        onToolResult: (payload) => dispatch({ type: "tool-result", payload }),
        onApprovalRequest: (payload, requestId) =>
          dispatch({ type: "approval-request", payload, ...(requestId === undefined ? {} : { requestId }) }),
        onError: (payload) => dispatch({ type: "error", payload }),
      },
    );

    clientRef.current = client;
    client.connect();

    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [settings, sessionId]);

  const send = useCallback((text: string) => {
    const client = clientRef.current;
    if (client === null) return;
    dispatch({ type: "user", text });
    try {
      client.send(text);
    } catch (err) {
      dispatch({
        type: "error",
        payload: { message: err instanceof Error ? err.message : "send failed" },
      });
    }
  }, []);

  const resolveApproval = useCallback(
    (approved: boolean, reason?: string) => {
      const client = clientRef.current;
      const pending = state.approval;
      dispatch({ type: "approval-clear" });
      if (client === null || pending === null) return;
      client.respondToApproval(approved, reason, pending.requestId);
    },
    [state.approval],
  );

  const canSend = useMemo(() => connection.status === "ready", [connection]);

  return {
    items: state.items,
    approval: state.approval,
    connection,
    send,
    resolveApproval,
    canSend,
  };
}
