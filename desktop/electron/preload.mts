import { contextBridge, ipcRenderer } from "electron";

/**
 * The capability bridge — the only path from renderer to machine.
 *
 * Keep it narrow and typed. Every addition here widens the renderer's
 * authority, so a new method needs the same scrutiny as a new tool in the
 * agent's registry. Never expose `ipcRenderer` itself.
 */
const bridge = {
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (next: unknown) => ipcRenderer.invoke("settings:set", next),
  },
  config: {
    read: () => ipcRenderer.invoke("config:read"),
    write: (contents: string) => ipcRenderer.invoke("config:write", contents),
  },
  gateway: {
    start: () => ipcRenderer.invoke("gateway:start"),
    stop: () => ipcRenderer.invoke("gateway:stop"),
    status: () => ipcRenderer.invoke("gateway:status"),
    logs: () => ipcRenderer.invoke("gateway:logs"),
    onStatus: (cb: (status: string) => void) => {
      const listener = (_e: unknown, status: string) => cb(status);
      ipcRenderer.on("gateway:status", listener);
      return () => ipcRenderer.removeListener("gateway:status", listener);
    },
    onLog: (cb: (line: string) => void) => {
      const listener = (_e: unknown, line: string) => cb(line);
      ipcRenderer.on("gateway:log", listener);
      return () => ipcRenderer.removeListener("gateway:log", listener);
    },
  },
  app: {
    platform: () => ipcRenderer.invoke("app:platform"),
  },
};

contextBridge.exposeInMainWorld("nullclaw", bridge);

export type NullclawBridge = typeof bridge;
