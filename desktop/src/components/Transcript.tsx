import type { PendingApproval, TranscriptItem } from "../state/transcript.js";

function ToolCall({ name, args }: { name: string; args: Record<string, unknown> }) {
  return (
    <div className="widget">
      <div className="widget-title">
        <span>tool</span>
        <span className="muted">{name}</span>
      </div>
      <pre>{JSON.stringify(args, null, 2)}</pre>
    </div>
  );
}

function ToolResult({ ok, result, error }: { ok: boolean; result?: unknown; error?: string }) {
  return (
    <div className="widget">
      <div className="widget-title">
        <span>result</span>
        <span className="status-dot" data-tone={ok ? "ok" : "danger"}>
          {ok ? "ok" : "failed"}
        </span>
      </div>
      <pre>{error ?? (typeof result === "string" ? result : JSON.stringify(result, null, 2))}</pre>
    </div>
  );
}

/**
 * Approval gate. The agent is blocked until this resolves, so it renders
 * inline and in the transcript's flow — never as a dialog that could be
 * dismissed without an answer.
 */
export function ApprovalPrompt({
  approval,
  onResolve,
}: {
  approval: PendingApproval;
  onResolve: (approved: boolean) => void;
}) {
  return (
    <div className="approval" role="alertdialog" aria-label="Approval required">
      <strong>Approval required</strong>
      <div className="turn-body" style={{ marginTop: 6 }}>
        {approval.action}
      </div>
      {approval.reason !== undefined && (
        <div className="muted" style={{ marginTop: 4 }}>
          {approval.reason}
        </div>
      )}
      <div className="approval-actions">
        <button className="btn" type="button" onClick={() => onResolve(true)}>
          Approve
        </button>
        <button
          className="btn"
          data-variant="danger"
          type="button"
          onClick={() => onResolve(false)}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

export function Transcript({ items }: { items: TranscriptItem[] }) {
  return (
    <>
      {items.map((item) => {
        switch (item.kind) {
          case "user":
          case "assistant":
            return (
              <div className="turn" data-role={item.kind} key={item.id}>
                <span className="turn-role">{item.kind}</span>
                <div className="turn-body">
                  {item.text}
                  {item.kind === "assistant" && item.streaming && <span aria-hidden> ▍</span>}
                </div>
              </div>
            );
          case "tool-call":
            return <ToolCall key={item.id} name={item.name} args={item.args} />;
          case "tool-result":
            return (
              <ToolResult
                key={item.id}
                ok={item.ok}
                {...(item.result === undefined ? {} : { result: item.result })}
                {...(item.error === undefined ? {} : { error: item.error })}
              />
            );
          case "error":
            return (
              <div className="error-state" key={item.id}>
                {item.code !== undefined ? `${item.code}: ` : ""}
                {item.message}
              </div>
            );
        }
      })}
    </>
  );
}
