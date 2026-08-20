import { useEffect, useMemo, useState } from "react";
import { Chat } from "./pages/Chat.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Cron } from "./pages/Cron.js";
import { Settings } from "./pages/Settings.js";
import { BROWSER_DEFAULT_SETTINGS, getBridge, type DesktopSettings } from "./bridge.js";
import { useSession } from "./state/useSession.js";
import type { ConnectionState } from "./transport/WebchannelClient.js";

type Route = "chat" | "dashboard" | "cron" | "settings";

const ROUTES: Array<{ id: Route; label: string }> = [
  { id: "chat", label: "Chat" },
  { id: "dashboard", label: "Dashboard" },
  { id: "cron", label: "Cron" },
  { id: "settings", label: "Settings" },
];

/** One place resolves connection status to a tone and a label. */
function ConnectionPill({ connection }: { connection: ConnectionState }) {
  const tone =
    connection.status === "ready" ? "ok" : connection.status === "failed" ? "danger" : "warn";
  const label =
    connection.status === "reconnecting"
      ? `reconnecting (${connection.attempt})`
      : connection.status === "failed"
        ? `failed: ${connection.reason}`
        : connection.status;
  return (
    <span className="status-dot" data-tone={tone}>
      {label}
    </span>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>("chat");
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const bridge = getBridge();

  // One session id per window launch. Sessions are backend-authoritative;
  // resuming an existing one is a follow-up, not a v1 concern.
  const sessionId = useMemo(
    () => `desktop-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  // The session lives here, not in Chat: navigating to Dashboard must not tear
  // down the socket or drop a streaming turn. One window, one socket.
  const session = useSession(settings, sessionId);

  useEffect(() => {
    if (bridge === null) {
      setSettings(BROWSER_DEFAULT_SETTINGS);
      return;
    }
    void bridge.settings.get().then(setSettings);
  }, [bridge]);

  const save = (next: DesktopSettings) => {
    setSettings(next);
    void bridge?.settings.set(next);
  };

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">NullClaw</div>
        {ROUTES.map((item) => (
          <button
            key={item.id}
            type="button"
            className="nav-item"
            aria-current={route === item.id ? "page" : undefined}
            onClick={() => setRoute(item.id)}
          >
            <span>{item.label}</span>
            {item.id === "chat" && session.approval !== null && (
              <span className="status-dot" data-tone="warn" aria-label="approval pending" />
            )}
          </button>
        ))}
      </nav>

      <div className="main">
        <header className="topbar">
          <h1>{ROUTES.find((r) => r.id === route)?.label}</h1>
          <ConnectionPill connection={session.connection} />
        </header>

        {/* Chat stays mounted so its scroll position and transcript survive
            navigation; other routes are cheap enough to unmount. */}
        <div style={{ display: route === "chat" ? "contents" : "none" }}>
          <Chat session={session} />
        </div>
        {route === "dashboard" && <Dashboard settings={settings} />}
        {route === "cron" && <Cron settings={settings} />}
        {route === "settings" && <Settings settings={settings} onSave={save} />}
      </div>
    </div>
  );
}
