import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebchannelClient, type ConnectionState } from "../src/transport/WebchannelClient.js";
import { FakeSocket, installFakeSocket } from "./fakeSocket.js";

const URL_ = "ws://127.0.0.1:32123/ws";

function pairingResult(overrides: Record<string, unknown> = {}) {
  return {
    v: 1,
    type: "pairing_result",
    session_id: "s1",
    payload: {
      ok: true,
      client_id: "ui-1",
      access_token: "jwt-abc",
      token_type: "Bearer",
      expires_in: 3600,
      e2e_required: false,
      ...overrides,
    },
  };
}

beforeEach(() => {
  installFakeSocket();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pairing ladder", () => {
  it("sends pairing_request on open and reports the pairing state", () => {
    const states: ConnectionState[] = [];
    const client = new WebchannelClient(
      { url: URL_, sessionId: "s1" },
      { onState: (s) => states.push(s) },
    );
    client.connect();
    FakeSocket.last.open();

    const frames = FakeSocket.last.frames();
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ v: 1, type: "pairing_request", session_id: "s1" });
    expect(states.map((s) => s.status)).toEqual(["connecting", "pairing"]);
  });

  it("refuses to send a user_message before pairing resolves", () => {
    const client = new WebchannelClient({ url: URL_, sessionId: "s1" });
    client.connect();
    FakeSocket.last.open();

    expect(() => client.send("hello")).toThrow(/before pairing/);
    // Only the pairing_request went out — the turn was not silently dropped
    // onto the wire without credentials.
    expect(FakeSocket.last.frames()).toHaveLength(1);
  });

  it("attaches the minted JWT to user_message after pairing", () => {
    const client = new WebchannelClient({ url: URL_, sessionId: "s1" });
    client.connect();
    FakeSocket.last.open();
    FakeSocket.last.deliver(pairingResult());

    expect(client.connectionState).toEqual({ status: "ready", clientId: "ui-1" });
    client.send("hello");

    const message = FakeSocket.last.frames()[1];
    expect(message).toMatchObject({
      type: "user_message",
      session_id: "s1",
      payload: { content: "hello", access_token: "jwt-abc" },
    });
  });

  it("fails closed when the core rejects pairing", () => {
    const client = new WebchannelClient({ url: URL_, sessionId: "s1" });
    client.connect();
    FakeSocket.last.open();
    FakeSocket.last.deliver(pairingResult({ ok: false }));

    expect(client.connectionState).toMatchObject({ status: "failed" });
    expect(() => client.send("hello")).toThrow();
  });

  it("forwards a relay pairing code when configured", () => {
    const client = new WebchannelClient({
      url: URL_,
      sessionId: "s1",
      pairingCode: "123456",
    });
    client.connect();
    FakeSocket.last.open();

    expect(FakeSocket.last.frames()[0]).toMatchObject({
      payload: { pairing_code: "123456" },
    });
  });
});

describe("token auth mode", () => {
  it("is ready on open without a pairing round trip", () => {
    const client = new WebchannelClient({
      url: URL_,
      sessionId: "s1",
      authMode: "token",
      authToken: "tok-xyz",
    });
    client.connect();
    FakeSocket.last.open();

    expect(client.connectionState).toEqual({ status: "ready" });
    expect(FakeSocket.last.frames()).toHaveLength(0);
  });

  it("sends the channel token on user_message", () => {
    const client = new WebchannelClient({
      url: URL_,
      sessionId: "s1",
      authMode: "token",
      authToken: "tok-xyz",
    });
    client.connect();
    FakeSocket.last.open();
    client.send("hi", "me");

    expect(FakeSocket.last.frames()[0]).toMatchObject({
      type: "user_message",
      payload: { content: "hi", sender_id: "me", auth_token: "tok-xyz" },
    });
  });

  it("puts the upgrade token in the query string", () => {
    // A browser WebSocket cannot set an Authorization header; web.zig accepts
    // ?token= for exactly this reason.
    const client = new WebchannelClient({
      url: URL_,
      sessionId: "s1",
      authMode: "token",
      authToken: "tok-xyz",
    });
    client.connect();
    expect(FakeSocket.last.url).toBe("ws://127.0.0.1:32123/ws?token=tok-xyz");
  });
});

describe("inbound frames", () => {
  function ready() {
    const events: string[] = [];
    const client = new WebchannelClient(
      { url: URL_, sessionId: "s1", authMode: "token", authToken: "t" },
      {
        onChunk: (p) => events.push(`chunk:${p.content}`),
        onFinal: (p) => events.push(`final:${p.content}`),
        onToolCall: (p) => events.push(`tool:${p.name}`),
        onToolResult: (p) => events.push(`result:${p.ok}`),
        onApprovalRequest: (p, id) => events.push(`approval:${p.action}:${id}`),
        onError: (p) => events.push(`error:${p.message}`),
      },
    );
    client.connect();
    FakeSocket.last.open();
    return { client, events };
  }

  it("routes each core-to-ui event to its handler", () => {
    const { events } = ready();
    const socket = FakeSocket.last;
    socket.deliver({ v: 1, type: "assistant_chunk", session_id: "s1", payload: { content: "a" } });
    socket.deliver({ v: 1, type: "assistant_final", session_id: "s1", payload: { content: "ab" } });
    socket.deliver({ v: 1, type: "tool_call", session_id: "s1", payload: { name: "shell", arguments: {} } });
    socket.deliver({ v: 1, type: "tool_result", session_id: "s1", payload: { ok: true } });
    socket.deliver({
      v: 1,
      type: "approval_request",
      session_id: "s1",
      request_id: "req-1",
      payload: { action: "rm" },
    });
    socket.deliver({ v: 1, type: "error", session_id: "s1", payload: { message: "nope" } });

    expect(events).toEqual([
      "chunk:a",
      "final:ab",
      "tool:shell",
      "result:true",
      "approval:rm:req-1",
      "error:nope",
    ]);
  });

  it("drops malformed and wrong-version frames without invoking handlers", () => {
    const { events } = ready();
    const socket = FakeSocket.last;
    socket.deliverRaw("{not json");
    socket.deliverRaw(new ArrayBuffer(4)); // binary frame
    socket.deliver({ v: 2, type: "assistant_final", session_id: "s1", payload: { content: "x" } });
    socket.deliver({ v: 1, type: "unknown_event", session_id: "s1" });

    expect(events).toEqual([]);
  });
});

describe("approval responses", () => {
  it("echoes the request_id so the core can correlate the answer", () => {
    const client = new WebchannelClient({
      url: URL_,
      sessionId: "s1",
      authMode: "token",
      authToken: "t",
    });
    client.connect();
    FakeSocket.last.open();
    client.respondToApproval(false, "too risky", "req-9");

    expect(FakeSocket.last.frames()[0]).toMatchObject({
      type: "approval_response",
      request_id: "req-9",
      payload: { approved: false, reason: "too risky" },
    });
  });

  it("omits reason when none is given", () => {
    const client = new WebchannelClient({
      url: URL_,
      sessionId: "s1",
      authMode: "token",
      authToken: "t",
    });
    client.connect();
    FakeSocket.last.open();
    client.respondToApproval(true);

    const payload = FakeSocket.last.frames()[0]?.payload as Record<string, unknown>;
    expect(payload).toEqual({ approved: true });
  });
});

describe("reconnection", () => {
  it("retries with growing delays and redials", () => {
    vi.useFakeTimers();
    const states: ConnectionState[] = [];
    const client = new WebchannelClient(
      { url: URL_, sessionId: "s1", authMode: "token", authToken: "t", maxRetries: 3 },
      { onState: (s) => states.push(s) },
    );
    client.connect();
    FakeSocket.last.open();
    FakeSocket.last.drop();

    const first = states.find((s) => s.status === "reconnecting");
    expect(first).toMatchObject({ attempt: 1, nextRetryMs: 500 });

    vi.advanceTimersByTime(500);
    expect(FakeSocket.instances).toHaveLength(2);

    FakeSocket.last.drop();
    const second = states.filter((s) => s.status === "reconnecting").at(-1);
    expect(second).toMatchObject({ attempt: 2, nextRetryMs: 1000 });
  });

  it("stops at the retry budget and reports why", () => {
    vi.useFakeTimers();
    const client = new WebchannelClient({
      url: URL_,
      sessionId: "s1",
      authMode: "token",
      authToken: "t",
      maxRetries: 2,
    });
    client.connect();
    FakeSocket.last.open();

    FakeSocket.last.drop(1006, "gateway down");
    vi.advanceTimersByTime(500);
    FakeSocket.last.drop(1006, "gateway down");
    vi.advanceTimersByTime(1000);
    FakeSocket.last.drop(1006, "gateway down");

    // Bounded: it ends in a reported failure, never an endless spinner.
    expect(client.connectionState).toEqual({ status: "failed", reason: "gateway down" });
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it("clears the access token on drop so a stale JWT is never reused", () => {
    vi.useFakeTimers();
    const client = new WebchannelClient({ url: URL_, sessionId: "s1", maxRetries: 3 });
    client.connect();
    FakeSocket.last.open();
    FakeSocket.last.deliver(pairingResult());
    expect(client.connectionState).toMatchObject({ status: "ready" });

    FakeSocket.last.drop();
    vi.advanceTimersByTime(500);
    FakeSocket.last.open();

    // Re-paired from scratch: sending before the new pairing_result throws.
    expect(() => client.send("hello")).toThrow(/before pairing/);
  });

  it("does not retry after an explicit close", () => {
    vi.useFakeTimers();
    const client = new WebchannelClient({
      url: URL_,
      sessionId: "s1",
      authMode: "token",
      authToken: "t",
    });
    client.connect();
    FakeSocket.last.open();
    client.close();
    FakeSocket.last.drop();
    vi.advanceTimersByTime(60_000);

    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.connectionState).toEqual({ status: "idle" });
  });

  it("throws rather than queueing when sending while disconnected", () => {
    const client = new WebchannelClient({
      url: URL_,
      sessionId: "s1",
      authMode: "token",
      authToken: "t",
    });
    client.connect();
    expect(() => client.send("hello")).toThrow(/disconnected/);
  });
});
