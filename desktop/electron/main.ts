import { app, BrowserWindow, ipcMain, shell } from "electron";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { GatewaySupervisor, type SupervisorStatus } from "./supervisor.js";

const here = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";

const CONFIG_PATH = join(homedir(), ".nullclaw", "config.json");
const SETTINGS_PATH = join(homedir(), ".nullclaw", "desktop.json");

let window: BrowserWindow | null = null;
let supervisor: GatewaySupervisor | null = null;

/** Renderer-visible settings. Machine facts stay on this side of the bridge. */
interface DesktopSettings {
  wsUrl: string;
  gatewayUrl: string;
  authMode: "pairing" | "token";
  authToken?: string;
  binaryPath: string;
  manageGateway: boolean;
}

const DEFAULT_SETTINGS: DesktopSettings = {
  // WebConfig defaults: 127.0.0.1:32123/ws, message_auth_mode="pairing".
  wsUrl: "ws://127.0.0.1:32123/ws",
  // export_manifest.zig declares gateway port 3000.
  gatewayUrl: "http://127.0.0.1:3000",
  authMode: "pairing",
  binaryPath: "nullclaw",
  manageGateway: false,
};

async function loadSettings(): Promise<DesktopSettings> {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<DesktopSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function saveSettings(next: DesktopSettings): Promise<void> {
  await mkdir(dirname(SETTINGS_PATH), { recursive: true });
  await writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 720,
    minHeight: 520,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0d0f12",
    webPreferences: {
      // Electron requires an ESM preload to carry the .mjs extension (and
      // sandbox: false). Source is preload.mts so tsc emits preload.mjs.
      preload: join(here, "preload.mjs"),
      // The renderer is untrusted with native capability. Everything it needs
      // arrives through the narrow bridge in preload.ts.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    void window.loadURL("http://127.0.0.1:5273");
  } else {
    void window.loadFile(join(here, "..", "dist", "index.html"));
  }

  // External links open in the user's browser, never in the app frame.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  window.on("closed", () => {
    window = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("settings:get", () => loadSettings());

  ipcMain.handle("settings:set", async (_event, next: DesktopSettings) => {
    await saveSettings(next);
    return next;
  });

  ipcMain.handle("config:read", async () => {
    if (!existsSync(CONFIG_PATH)) return null;
    return readFile(CONFIG_PATH, "utf8");
  });

  ipcMain.handle("config:write", async (_event, contents: string) => {
    // Parse before writing: a malformed config bricks the agent on next boot.
    JSON.parse(contents);
    await mkdir(dirname(CONFIG_PATH), { recursive: true });
    await writeFile(CONFIG_PATH, contents, "utf8");
    return true;
  });

  ipcMain.handle("gateway:start", async () => {
    const settings = await loadSettings();
    if (supervisor === null) {
      supervisor = new GatewaySupervisor({ binary: settings.binaryPath });
      supervisor.on("status", (status: SupervisorStatus) => {
        window?.webContents.send("gateway:status", status);
      });
      supervisor.on("log", (line: string) => {
        window?.webContents.send("gateway:log", line);
      });
    }
    supervisor.start();
    return supervisor.currentStatus;
  });

  ipcMain.handle("gateway:stop", () => {
    supervisor?.stop();
    return supervisor?.currentStatus ?? "stopped";
  });

  ipcMain.handle("gateway:status", () => supervisor?.currentStatus ?? "stopped");
  ipcMain.handle("gateway:logs", () => supervisor?.logs ?? []);
  ipcMain.handle("app:platform", () => ({
    platform: process.platform,
    arch: process.arch,
    version: app.getVersion(),
  }));
}

void app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// A supervised gateway is ours to clean up; an externally started one is not.
app.on("before-quit", () => {
  supervisor?.stop();
});
