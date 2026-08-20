import { describe, expect, it } from "vitest";
import {
  WEBCHANNEL_VERSION,
  isCoreToUi,
  parseEnvelope,
} from "../src/protocol/webchannel.js";

const valid = JSON.stringify({
  v: 1,
  type: "assistant_final",
  session_id: "s1",
  payload: { content: "hi" },
});

describe("parseEnvelope", () => {
  it("accepts a well-formed v1 envelope", () => {
    const frame = parseEnvelope(valid);
    expect(frame).not.toBeNull();
    expect(frame?.type).toBe("assistant_final");
    expect(frame?.session_id).toBe("s1");
  });

  it("rejects a version other than 1", () => {
    // A v2 core must not be rendered by a v1 client guessing at the shape.
    const frame = parseEnvelope(JSON.stringify({ v: 2, type: "assistant_final", session_id: "s1" }));
    expect(frame).toBeNull();
  });

  it("rejects a string version that merely looks right", () => {
    expect(parseEnvelope(JSON.stringify({ v: "1", type: "error", session_id: "s" }))).toBeNull();
  });

  it("rejects malformed JSON rather than throwing", () => {
    expect(parseEnvelope("{not json")).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(parseEnvelope("null")).toBeNull();
    expect(parseEnvelope('"a string"')).toBeNull();
    expect(parseEnvelope("42")).toBeNull();
    expect(parseEnvelope("[]")).toBeNull();
  });

  it("rejects frames missing required envelope fields", () => {
    expect(parseEnvelope(JSON.stringify({ v: 1, type: "error" }))).toBeNull();
    expect(parseEnvelope(JSON.stringify({ v: 1, session_id: "s" }))).toBeNull();
  });

  it("rejects a non-string session_id", () => {
    expect(parseEnvelope(JSON.stringify({ v: 1, type: "error", session_id: 7 }))).toBeNull();
  });

  it("pins the wire version at 1", () => {
    expect(WEBCHANNEL_VERSION).toBe(1);
  });
});

describe("isCoreToUi", () => {
  it("accepts every core-to-ui event in the spec", () => {
    for (const name of [
      "pairing_result",
      "assistant_chunk",
      "assistant_final",
      "tool_call",
      "tool_result",
      "approval_request",
      "error",
    ]) {
      expect(isCoreToUi(name)).toBe(true);
    }
  });

  it("rejects ui-to-core-only events and unknown names", () => {
    expect(isCoreToUi("user_message")).toBe(false);
    expect(isCoreToUi("pairing_request")).toBe(false);
    expect(isCoreToUi("approval_response")).toBe(false);
    expect(isCoreToUi("not_an_event")).toBe(false);
  });
});
