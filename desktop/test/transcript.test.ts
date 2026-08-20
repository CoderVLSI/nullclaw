import { describe, expect, it } from "vitest";
import {
  initialTranscript,
  transcriptReducer,
  type TranscriptAction,
  type TranscriptState,
} from "../src/state/transcript.js";

/** Fold a sequence of events, as the socket would deliver them. */
function run(...actions: TranscriptAction[]): TranscriptState {
  return actions.reduce(transcriptReducer, initialTranscript);
}

const chunk = (content: string): TranscriptAction => ({ type: "chunk", payload: { content } });
const final = (content: string): TranscriptAction => ({ type: "final", payload: { content } });

describe("streaming reconciliation", () => {
  it("appends successive chunks into one open turn", () => {
    const state = run(chunk("Hel"), chunk("lo "), chunk("world"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      kind: "assistant",
      text: "Hello world",
      streaming: true,
    });
  });

  it("lets assistant_final replace the accumulated chunks", () => {
    // The core resends the whole message, so a dropped chunk cannot corrupt
    // the turn.
    const state = run(chunk("Hel"), chunk("lo wrld"), final("Hello world"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({ text: "Hello world", streaming: false });
    expect(state.streamingId).toBeNull();
  });

  it("treats an empty final as a terminator and keeps what streamed", () => {
    const state = run(chunk("partial"), final(""));
    expect(state.items[0]).toMatchObject({ text: "partial", streaming: false });
  });

  it("renders a final with no preceding chunk as a complete turn", () => {
    const state = run(final("one shot"));
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toMatchObject({
      kind: "assistant",
      text: "one shot",
      streaming: false,
    });
  });

  it("ignores an empty chunk instead of opening a turn", () => {
    const state = run(chunk(""));
    expect(state.items).toHaveLength(0);
    expect(state.streamingId).toBeNull();
  });

  it("starts a new turn after a final closes the previous one", () => {
    const state = run(chunk("first"), final("first"), chunk("second"));
    expect(state.items).toHaveLength(2);
    expect(state.items[1]).toMatchObject({ text: "second", streaming: true });
  });

  it("closes the open turn when a tool call interrupts it", () => {
    // Text arriving after a tool call is a new message, not a continuation.
    const state = run(
      chunk("thinking"),
      { type: "tool-call", payload: { name: "shell", arguments: { cmd: "ls" } } },
      chunk("done"),
    );
    expect(state.items).toHaveLength(3);
    expect(state.items[0]).toMatchObject({ text: "thinking", streaming: false });
    expect(state.items[1]).toMatchObject({ kind: "tool-call", name: "shell" });
    expect(state.items[2]).toMatchObject({ kind: "assistant", text: "done" });
  });
});

describe("tool results", () => {
  it("keeps a failure's error and omits an absent result", () => {
    const state = run({
      type: "tool-result",
      payload: { ok: false, error: "permission denied" },
    });
    expect(state.items[0]).toMatchObject({ kind: "tool-result", ok: false, error: "permission denied" });
    expect(state.items[0]).not.toHaveProperty("result");
  });

  it("preserves a falsy result value", () => {
    const state = run({ type: "tool-result", payload: { ok: true, result: 0 } });
    expect(state.items[0]).toMatchObject({ ok: true, result: 0 });
  });
});

describe("approvals", () => {
  it("carries the request_id through so the answer can be correlated", () => {
    const state = run({
      type: "approval-request",
      payload: { action: "rm -rf /tmp/x", reason: "cleanup" },
      requestId: "req-42",
    });
    expect(state.approval).toMatchObject({
      action: "rm -rf /tmp/x",
      reason: "cleanup",
      requestId: "req-42",
    });
  });

  it("omits requestId when the core did not send one", () => {
    const state = run({ type: "approval-request", payload: { action: "x" } });
    expect(state.approval).not.toHaveProperty("requestId");
  });

  it("clears the pending approval once answered", () => {
    const state = run(
      { type: "approval-request", payload: { action: "x" } },
      { type: "approval-clear" },
    );
    expect(state.approval).toBeNull();
  });

  it("keeps only the newest ask if the core sends a second", () => {
    const state = run(
      { type: "approval-request", payload: { action: "first" } },
      { type: "approval-request", payload: { action: "second" } },
    );
    expect(state.approval).toMatchObject({ action: "second" });
  });
});

describe("identity and purity", () => {
  it("gives every item a distinct id", () => {
    const state = run(
      { type: "user", text: "a" },
      final("b"),
      { type: "tool-call", payload: { name: "t", arguments: {} } },
      { type: "error", payload: { message: "boom" } },
    );
    const ids = state.items.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not mutate the state it is given", () => {
    const before = run(chunk("hello"));
    const snapshot = JSON.stringify(before);
    transcriptReducer(before, chunk(" more"));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("clears everything on reset", () => {
    const state = run(
      { type: "user", text: "a" },
      { type: "approval-request", payload: { action: "x" } },
      { type: "reset" },
    );
    expect(state).toEqual(initialTranscript);
  });
});
