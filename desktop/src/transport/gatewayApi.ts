/**
 * REST client for the gateway's operational surface.
 *
 * Route set mirrors `src/gateway.zig` — `/health`, `/ready`, `/status`,
 * `/doctor` plus the `/cron/*` CRUD block. Shapes are intentionally loose
 * (`unknown` + accessors) because the Zig side owns them; the dashboard
 * renders what it recognises and shows raw JSON for the rest.
 */

export interface GatewayTarget {
  /** e.g. `http://127.0.0.1:3000` — gateway default port is 3000. */
  baseUrl: string;
  /** Bearer token when the gateway is not on loopback. */
  token?: string;
}

export interface CronJob {
  id?: string;
  name?: string;
  schedule?: string;
  paused?: boolean;
  [key: string]: unknown;
}

export class GatewayApi {
  constructor(private readonly target: GatewayTarget) {}

  health(): Promise<unknown> {
    return this.get("/health");
  }
  ready(): Promise<unknown> {
    return this.get("/ready");
  }
  status(): Promise<unknown> {
    return this.get("/status");
  }
  doctor(): Promise<unknown> {
    return this.get("/doctor");
  }

  async cronList(): Promise<CronJob[]> {
    const body = await this.get("/cron");
    if (Array.isArray(body)) return body as CronJob[];
    if (typeof body === "object" && body !== null) {
      const jobs = (body as Record<string, unknown>).jobs;
      if (Array.isArray(jobs)) return jobs as CronJob[];
    }
    return [];
  }

  cronAdd(job: CronJob): Promise<unknown> {
    return this.post("/cron/add", job);
  }
  cronRemove(id: string): Promise<unknown> {
    return this.post("/cron/remove", { id });
  }
  cronPause(id: string): Promise<unknown> {
    return this.post("/cron/pause", { id });
  }
  cronResume(id: string): Promise<unknown> {
    return this.post("/cron/resume", { id });
  }
  cronUpdate(job: CronJob): Promise<unknown> {
    return this.post("/cron/update", job);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private headers(): HeadersInit {
    return {
      "Content-Type": "application/json",
      ...(this.target.token === undefined
        ? {}
        : { Authorization: `Bearer ${this.target.token}` }),
    };
  }

  private async get(path: string): Promise<unknown> {
    const res = await fetch(`${this.target.baseUrl}${path}`, { headers: this.headers() });
    return this.unwrap(res, path);
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await fetch(`${this.target.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    return this.unwrap(res, path);
  }

  private async unwrap(res: Response, path: string): Promise<unknown> {
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`gateway ${path}: ${res.status} ${text.slice(0, 200)}`);
    }
    if (text.length === 0) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}
