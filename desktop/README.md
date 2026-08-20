# NullClaw Desktop

A native desktop front end for a NullClaw gateway. It is a client, not a second
implementation: sessions, tools, memory, and model calls all stay in the Zig
core, and this app talks to it over the existing `webchannel_v1` WebSocket
protocol plus the gateway's REST surface.

Architecture and contracts: [`AGENTS.md`](./AGENTS.md).

## What it does

- **Chat with streaming** — `user_message` out; `assistant_chunk` streams into
  the open turn, `assistant_final` closes it.
- **Tool calls and results** — rendered inline as they arrive.
- **Approval gating** — `approval_request` blocks the agent and surfaces an
  Approve/Deny prompt in the transcript; the answer goes back as
  `approval_response` correlated by `request_id`.
- **Gateway dashboard** — polls `/health`, `/ready`, `/status`, `/doctor`, and
  can start/stop and tail the logs of a locally supervised `nullclaw gateway`.
- **Cron management** — list, add, pause, resume, and remove jobs over
  `/cron/*`.
- **Settings** — connection target, auth mode, token, plus an editor for
  `~/.nullclaw/config.json` that refuses to write malformed JSON.

## Requirements

Node 20+ and a `nullclaw` binary. The desktop app does not build the Zig core —
build or install that separately (`zig build -Doptimize=ReleaseSmall`).

## Development

```bash
cd desktop
npm install

# Terminal 1 — the agent, with the web channel enabled in ~/.nullclaw/config.json
nullclaw gateway

# Terminal 2 — Vite dev server
npm run dev

# Terminal 3 — Electron pointed at the dev server
NODE_ENV=development npm run dev:electron
```

The renderer is shell-agnostic, so `npm run dev` alone opens a working app in a
browser at <http://127.0.0.1:5273>. Native features (process supervision,
config editing) are hidden when the Electron bridge is absent.

## Build and package

```bash
npm run typecheck
npm run build      # renderer + Electron main
npm run package    # platform installers via electron-builder
```

## Connecting

Defaults match the Zig-side defaults in `src/config_types.zig` and
`src/export_manifest.zig`:

| Setting | Default | Source |
| --- | --- | --- |
| Web channel URL | `ws://127.0.0.1:32123/ws` | `WebConfig.port` / `.listen` / `.path` |
| Gateway URL | `http://127.0.0.1:3000` | manifest `gateway` port |
| Auth mode | `pairing` | `WebConfig.DEFAULT_MESSAGE_AUTH_MODE` |

Enable the web channel in `~/.nullclaw/config.json`:

```json
{
  "channels": {
    "web": {
      "transport": "local",
      "listen": "127.0.0.1",
      "port": 32123,
      "path": "/ws",
      "message_auth_mode": "pairing"
    }
  }
}
```

Keep `listen` on loopback. Binding the web channel to a public address requires
a token and is rejected otherwise — see the guards in `src/channels/web.zig`.
To reach a gateway on another machine (a Pi on your LAN, say), prefer an SSH
tunnel over a public bind:

```bash
ssh -N -L 32123:127.0.0.1:32123 -L 3000:127.0.0.1:3000 pi@nullclaw-box
```

## Relationship to nullhub

Upstream ships [nullhub](https://github.com/nullclaw/nullhub), a hosted UI for
the Null ecosystem. This is a different thing: a local desktop client for a
single gateway, with native process supervision. If you want browser-based
multi-service orchestration, use nullhub.
