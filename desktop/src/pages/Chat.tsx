import { useEffect, useRef } from "react";
import { Composer } from "../components/Composer.js";
import { ApprovalPrompt, Transcript } from "../components/Transcript.js";
import type { useSession } from "../state/useSession.js";

export function Chat({ session }: { session: ReturnType<typeof useSession> }) {
  const { items, approval, send, resolveApproval, canSend } = session;
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [items, approval]);

  return (
    <>
      <div className="transcript">
        {items.length === 0 && approval === null && (
          <p className="muted">
            Connected to a nullclaw gateway over <code>webchannel_v1</code>. Send a message to
            start the session.
          </p>
        )}
        <Transcript items={items} />
        {approval !== null && (
          <ApprovalPrompt approval={approval} onResolve={resolveApproval} />
        )}
        <div ref={bottom} />
      </div>
      <Composer disabled={!canSend} onSend={send} />
    </>
  );
}
