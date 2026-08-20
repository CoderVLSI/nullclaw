# Desktop Architecture

Contract for `desktop/` — the NullClaw desktop front end. Read this before
adding a page, a store, or an IPC handler. `DESIGN.md` conventions are folded
into `src/styles.css`; this file owns architecture, state, transport, and
process ownership.

This directory is deliberately **outside `src/`**. It is TypeScript, not Zig,
and it must never affect the binary size budget, the `zig build test` matrix,
or the rules in the repository-root `AGENTS.md`.

## Three authoritative parties

| Party | Owns |
| --- | --- |
| **Electron main** (`electron/`) | The machine: window lifecycle, spawning and supervising `nullclaw gateway`, reading and writing `~/.nullclaw/*`, install/update |
| **Renderer** (`src/`) | Navigation, presentation, ephemeral interaction state |
| **NullClaw core** (the Zig binary) | Sessions, tools, model calls, streaming, approvals |

Keep the seams clean. **The renderer never reaches for Node or Electron
directly.** Everything it needs from the machine arrives through the typed
capability bridge in `electron/preload.ts`, surfaced to the renderer as
`window.nullclaw` and typed in `src/bridge.ts`.

Every method added to that bridge widens the renderer's authority. Treat a new
bridge method with the same scrutiny the root `AGENTS.md` demands for a new
tool in the agent's registry.

## State placement follows authority, not convenience

- **Core-authoritative** — transcript, tool calls, approvals, cron jobs,
  health. Anything another nullclaw surface (CLI, another channel) can also
  change. The renderer holds a *cache* of these and must reconcile, never
  assume.
- **Electron-authoritative** — binary path, spawned-process status, config file
  contents, platform facts.
- **Renderer-authoritative** — current route, composer draft, scroll position.

A connection change (gateway URL, auth mode) is a **soft re-home**: the shell
stays mounted and the socket is torn down and redialled. `useSession` keys its
effect on `settings`, so this happens by construction.

## Transport

The renderer speaks exactly one protocol to the core: **`webchannel_v1`**,
defined by `spec/webchannel_v1.json` at the repository root and served by
`src/channels/web.zig` at `ws://<listen>:<port><path>` (defaults
`127.0.0.1:32123/ws`).

- `src/protocol/webchannel.ts` is a **typed mirror of the spec**. If the spec
  changes, change it here in the same commit — a stale type here is a bug
  exactly like a stale doc.
- `src/transport/WebchannelClient.ts` owns one socket and the credential ladder
  behind it. It imports neither React nor Electron, so the same class backs the
  packaged app, a browser tab, and a test harness.
- `src/transport/gatewayApi.ts` covers the gateway's REST surface
  (`/health`, `/ready`, `/status`, `/doctor`, `/cron/*` from `src/gateway.zig`).
  Response shapes stay `unknown` because the Zig side owns them; render what
  is recognised and show raw JSON for the rest.

Auth mirrors `WebConfig.message_auth_mode`:

- `pairing` (the Zig default) — dial, send `pairing_request`, wait for the JWT
  in `pairing_result`, then attach it to every `user_message`. Sending before
  pairing resolves throws rather than dropping the turn silently.
- `token` — attach the channel `auth_token` directly.

In both modes the WS-upgrade token rides in the query string, because a browser
`WebSocket` cannot set an `Authorization` header. `web.zig` accepts either.

Retries are **bounded** and end in a real recovery affordance — never an
infinite spinner.

## One window, one socket

`useSession` is instantiated once, in `App`. Pages receive it as a prop.
Navigating to Dashboard must not tear down the socket or drop a streaming turn,
so Chat stays mounted and hidden rather than unmounting.

## Streaming

`assistant_chunk` appends into the currently open assistant turn.
`assistant_final` carries the whole message and **replaces** the accumulated
text, so a dropped chunk cannot corrupt a turn.

## Approvals are not dialogs

`approval_request` blocks the agent until answered. It renders inline in the
transcript flow, never as a dismissible dialog — there is no path where the
user closes it without giving an answer.

## Shell portability

Electron is the shipped shell, matching the reference Hermes Desktop
architecture. The renderer does not depend on it: `getBridge()` returns `null`
in a browser and every caller handles that. Swapping the shell (for a
Tauri/webview build closer to nullclaw's size budget) means replacing
`electron/` and re-implementing the same bridge surface — nothing in `src/`
should need to change.

## Testing rules

Test behaviour that would actually break a user, not a snapshot of today's
data. The paths that matter:

- Envelope parse/reject — `parseEnvelope` must drop wrong-`v` and malformed frames.
- The pairing ladder — no `user_message` before `pairing_result`.
- Chunk/final reconciliation, including a `final` with no preceding chunk.
- Approval correlation — the `request_id` on the response matches the ask.
- Backoff bounds — retry stops at the budget and reports a reason.

Run them with `npm test`. Reconciliation lives in `src/state/transcript.ts` as a
pure reducer precisely so these rules are testable without a DOM; keep new
streaming rules there rather than in the hook.
