/**
 * Typed access to the Electron capability bridge.
 *
 * The bridge is optional on purpose: the same renderer runs in a browser tab
 * pointed at a remote gateway, where there is no machine to own. Callers must
 * handle `null` rather than assume Electron.
 */

export interface DesktopSettings {
  wsUrl: string;
  gatewayUrl: string;
  authMode: "pairing" | "token";
  authToken?: string;
  binaryPath: string;
  manageGateway: boolean;
}

export type GatewayProcessStatus = "stopped" | "starting" | "running" | "crashed";

export interface NullclawBridge {
  settings: {
    get(): Promise<DesktopSettings>;
    set(next: DesktopSettings): Promise<DesktopSettings>;
  };
  config: {
    read(): Promise<string | null>;
    write(contents: string): Promise<boolean>;
  };
  gateway: {
    start(): Promise<GatewayProcessStatus>;
    stop(): Promise<GatewayProcessStatus>;
    status(): Promise<GatewayProcessStatus>;
    logs(): Promise<string[]>;
    onStatus(cb: (status: GatewayProcessStatus) => void): () => void;
    onLog(cb: (line: string) => void): () => void;
  };
  app: {
    platform(): Promise<{ platform: string; arch: string; version: string }>;
  };
}

declare global {
  interface Window {
    nullclaw?: NullclawBridge;
  }
}

export function getBridge(): NullclawBridge | null {
  return typeof window !== "undefined" && window.nullclaw !== undefined
    ? window.nullclaw
    : null;
}

/** Settings fallback for the browser case, matching the Zig-side defaults. */
export const BROWSER_DEFAULT_SETTINGS: DesktopSettings = {
  wsUrl: "ws://127.0.0.1:32123/ws",
  gatewayUrl: "http://127.0.0.1:3000",
  authMode: "pairing",
  binaryPath: "nullclaw",
  manageGateway: false,
};
