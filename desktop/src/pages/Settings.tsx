import { useEffect, useState } from "react";
import { getBridge, type DesktopSettings } from "../bridge.js";

export function Settings({
  settings,
  onSave,
}: {
  settings: DesktopSettings | null;
  onSave: (next: DesktopSettings) => void;
}) {
  const [draft, setDraft] = useState<DesktopSettings | null>(settings);
  const [config, setConfig] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const bridge = getBridge();

  useEffect(() => setDraft(settings), [settings]);

  useEffect(() => {
    if (bridge === null) return;
    void bridge.config.read().then(setConfig);
  }, [bridge]);

  if (draft === null) return <div className="page muted">Loading…</div>;

  const patch = (fields: Partial<DesktopSettings>) => {
    setDraft({ ...draft, ...fields });
    setSaved(false);
  };

  return (
    <div className="page">
      <div className="card">
        <h2>Connection</h2>
        <div className="field">
          <label htmlFor="ws-url">Web channel URL</label>
          <input id="ws-url" value={draft.wsUrl} onChange={(e) => patch({ wsUrl: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="gw-url">Gateway URL</label>
          <input id="gw-url" value={draft.gatewayUrl} onChange={(e) => patch({ gatewayUrl: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="auth-mode">Auth mode</label>
          <select
            id="auth-mode"
            value={draft.authMode}
            onChange={(e) => patch({ authMode: e.target.value as DesktopSettings["authMode"] })}
          >
            <option value="pairing">pairing (default)</option>
            <option value="token">token</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="auth-token">Auth token</label>
          <input
            id="auth-token"
            type="password"
            value={draft.authToken ?? ""}
            onChange={(e) => patch({ authToken: e.target.value })}
            placeholder="required off loopback, or for message_auth_mode=token"
          />
        </div>
        {bridge !== null && (
          <div className="field">
            <label htmlFor="binary">nullclaw binary</label>
            <input id="binary" value={draft.binaryPath} onChange={(e) => patch({ binaryPath: e.target.value })} />
          </div>
        )}
        <button
          className="btn"
          type="button"
          onClick={() => {
            onSave(draft);
            setSaved(true);
          }}
        >
          Save
        </button>
        {saved && <span className="muted" style={{ marginLeft: 10 }}>Saved — reconnecting.</span>}
      </div>

      {bridge !== null && (
        <div className="card">
          <h2>~/.nullclaw/config.json</h2>
          {config === null ? (
            <p className="muted">No config file found.</p>
          ) : (
            <>
              <textarea
                rows={16}
                value={config}
                onChange={(e) => setConfig(e.target.value)}
                style={{ width: "100%", fontFamily: "var(--font-mono)", fontSize: 12 }}
              />
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    // Main rejects malformed JSON — a bad config bricks the
                    // agent at next boot, so it never reaches disk.
                    bridge.config
                      .write(config)
                      .then(() => setConfigError(null))
                      .catch((err: unknown) =>
                        setConfigError(err instanceof Error ? err.message : "write failed"),
                      );
                  }}
                >
                  Write config
                </button>
                {configError !== null && (
                  <span className="error-state" style={{ marginLeft: 10 }}>{configError}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
