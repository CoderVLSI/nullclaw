import { spawn, type ChildProcessByStdio } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

export type SupervisorStatus = "stopped" | "starting" | "running" | "crashed";

export interface SupervisorOptions {
  /** Path to the `nullclaw` binary. */
  binary: string;
  /** Sub-command; `gateway` is the manifest's declared launch command. */
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Owns the lifetime of a locally spawned `nullclaw gateway`.
 *
 * Electron owns the machine, so process supervision lives here and never in
 * the renderer. Mirrors the backoff shape of `src/daemon.zig` rather than
 * inventing a second restart policy.
 */
export class GatewaySupervisor extends EventEmitter {
  // stdio is ["ignore", "pipe", "pipe"], so stdin is null and the child is
  // not a ChildProcessWithoutNullStreams.
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private status: SupervisorStatus = "stopped";
  private restarts = 0;
  private stopping = false;
  private logBuffer: string[] = [];

  private static readonly MAX_RESTARTS = 5;
  private static readonly MAX_LOG_LINES = 500;

  constructor(private readonly options: SupervisorOptions) {
    super();
  }

  get currentStatus(): SupervisorStatus {
    return this.status;
  }

  get logs(): string[] {
    return [...this.logBuffer];
  }

  start(): void {
    if (this.child !== null) return;
    this.stopping = false;
    this.setStatus("starting");

    const child = spawn(this.options.binary, this.options.args ?? ["gateway"], {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;

    child.stdout.on("data", (chunk: Buffer) => this.appendLog(chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => this.appendLog(chunk.toString()));

    child.on("spawn", () => this.setStatus("running"));

    child.on("error", (err: Error) => {
      this.appendLog(`[supervisor] spawn failed: ${err.message}`);
      this.child = null;
      this.setStatus("crashed");
    });

    child.on("exit", (code: number | null, signal: string | null) => {
      this.child = null;
      if (this.stopping) {
        this.setStatus("stopped");
        return;
      }
      this.appendLog(`[supervisor] exited code=${code} signal=${signal}`);
      this.setStatus("crashed");
      this.maybeRestart();
    });
  }

  stop(): void {
    this.stopping = true;
    const child = this.child;
    if (child === null) {
      this.setStatus("stopped");
      return;
    }
    child.kill("SIGTERM");
  }

  private maybeRestart(): void {
    if (this.restarts >= GatewaySupervisor.MAX_RESTARTS) {
      this.appendLog("[supervisor] restart budget exhausted; staying down");
      return;
    }
    const delay = Math.min(500 * 2 ** this.restarts, 15_000);
    this.restarts += 1;
    setTimeout(() => {
      if (!this.stopping) this.start();
    }, delay);
  }

  private appendLog(text: string): void {
    for (const line of text.split("\n")) {
      if (line.length === 0) continue;
      this.logBuffer.push(line);
      this.emit("log", line);
    }
    if (this.logBuffer.length > GatewaySupervisor.MAX_LOG_LINES) {
      this.logBuffer = this.logBuffer.slice(-GatewaySupervisor.MAX_LOG_LINES);
    }
  }

  private setStatus(next: SupervisorStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.emit("status", next);
  }
}
