import { useCallback, useEffect, useState } from "react";
import { GatewayApi, type CronJob } from "../transport/gatewayApi.js";
import type { DesktopSettings } from "../bridge.js";

/** UI over the `/cron/*` CRUD block in `src/gateway.zig`. */
export function Cron({ settings }: { settings: DesktopSettings | null }) {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [prompt, setPrompt] = useState("");

  const api =
    settings === null
      ? null
      : new GatewayApi({
          baseUrl: settings.gatewayUrl,
          ...(settings.authToken === undefined ? {} : { token: settings.authToken }),
        });

  const refresh = useCallback(async () => {
    if (settings === null) return;
    const client = new GatewayApi({
      baseUrl: settings.gatewayUrl,
      ...(settings.authToken === undefined ? {} : { token: settings.authToken }),
    });
    try {
      setJobs(await client.cronList());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "cron list failed");
    }
  }, [settings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Direct manipulation updates the view first; the refresh reconciles, and a
  // failure surfaces rather than silently reverting.
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "cron request failed");
    }
    await refresh();
  };

  return (
    <div className="page">
      <div className="card">
        <h2>Add job</h2>
        <div className="field">
          <label htmlFor="cron-name">Name</label>
          <input id="cron-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="cron-schedule">Schedule</label>
          <input
            id="cron-schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 9 * * 1-5"
          />
        </div>
        <div className="field">
          <label htmlFor="cron-prompt">Prompt</label>
          <textarea id="cron-prompt" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <button
          className="btn"
          type="button"
          disabled={api === null || name.trim() === "" || schedule.trim() === ""}
          onClick={() =>
            void run(async () => {
              await api?.cronAdd({ name, schedule, prompt });
              setName("");
              setSchedule("");
              setPrompt("");
            })
          }
        >
          Add
        </button>
      </div>

      {error !== null && <div className="error-state">{error}</div>}

      <div className="card">
        <h2>Jobs</h2>
        {jobs.length === 0 ? (
          <p className="muted">No cron jobs registered.</p>
        ) : (
          <table className="rows">
            <thead>
              <tr>
                <th>Name</th>
                <th>Schedule</th>
                <th>State</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job, index) => {
                const id = job.id ?? job.name ?? String(index);
                return (
                  <tr key={id}>
                    <td>{job.name ?? id}</td>
                    <td className="muted">{job.schedule ?? "—"}</td>
                    <td>{job.paused === true ? "paused" : "active"}</td>
                    <td style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        className="btn"
                        data-variant="outline"
                        type="button"
                        onClick={() =>
                          void run(() =>
                            job.paused === true ? api!.cronResume(id) : api!.cronPause(id),
                          )
                        }
                      >
                        {job.paused === true ? "Resume" : "Pause"}
                      </button>
                      <button
                        className="btn"
                        data-variant="danger"
                        type="button"
                        onClick={() => void run(() => api!.cronRemove(id))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
