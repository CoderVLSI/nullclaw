import { useCallback, useEffect, useState } from "react";
import { GatewayApi } from "../transport/gatewayApi.js";
import { getBridge, type DesktopSettings, type GatewayProcessStatus } from "../bridge.js";

interface Probe {
  label: string;
  value: unknown;
  error?: string;
}

/** Operational view over `/health`, `/ready`, `/status`, `/doctor`. */
export function Dashboard({ settings }: { settings: DesktopSettings | null }) {
  const [probes, setProbes] = useState<Probe[]>([]);
  const [processStatus, setProcessStatus] = useState<GatewayProcessStatus>("stopped");
  const [logs, setLogs] = useState<string[]>([]);
  const bridge = getBridge();

  const refresh = useCallback(async () => {
    if (settings === null) return;
    const api = new GatewayApi({
      baseUrl: settings.gatewayUrl,
      ...(settings.authToken === undefined ? {} : { token: settings.authToken }),
    });
    const checks: Array<[string, () => Promise<unknown>]> = [
      ["health", () => api.health()],
      ["ready", () => api.ready()],
      ["status", () => api.status()],
      ["doctor", () => api.doctor()],
    ];
    const next = await Promise.all(
      checks.map(async ([label, run]): Promise<Probe> => {
        try {
          return { label, value: await run() };
        } catch (err) {
          return {
            label,
            value: null,
            error: err instanceof Error ? err.message : "probe failed",
          };
        }
      }),
    );
    setProbes(next);
  }, [settings]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000); // manifest health interval
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (bridge === null) return;
    void bridge.gateway.status().then(setProcessStatus);
    void bridge.gateway.logs().then(setLogs);
    const offStatus = bridge.gateway.onStatus(setProcessStatus);
    const offLog = bridge.gateway.onLog((line) =>
      setLogs((prev) => [...prev.slice(-499), line]),
    );
    return () => {
      offStatus();
      offLog();
    };
  }, [bridge]);

  return (
    <div className="page">
      {bridge !== null && (
        <div className="card">
          <h2>Local gateway process</h2>
          <div className="status-dot" data-tone={processStatus === "running" ? "ok" : processStatus === "crashed" ? "danger" : "warn"}>
            {processStatus}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              className="btn"
              type="button"
              onClick={() => void bridge.gateway.start()}
              disabled={processStatus === "running" || processStatus === "starting"}
            >
              Start
            </button>
            <button
              className="btn"
              data-variant="secondary"
              type="button"
              onClick={() => void bridge.gateway.stop()}
              disabled={processStatus === "stopped"}
            >
              Stop
            </button>
          </div>
          {logs.length > 0 && (
            <pre style={{ marginTop: 12, maxHeight: 180, overflowY: "auto" }}>
              {logs.slice(-60).join("\n")}
            </pre>
          )}
        </div>
      )}

      {probes.map((probe) => (
        <div className="card" key={probe.label}>
          <h2>/{probe.label}</h2>
          {probe.error !== undefined ? (
            <div className="error-state">{probe.error}</div>
          ) : (
            <pre>{JSON.stringify(probe.value, null, 2)}</pre>
          )}
        </div>
      ))}
    </div>
  );
}
