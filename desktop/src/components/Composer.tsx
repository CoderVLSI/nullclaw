import { useState, type KeyboardEvent } from "react";

export function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (text.length === 0 || disabled) return;
    onSend(text);
    setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter newlines — the convention every chat surface uses.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="composer">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={disabled ? "Waiting for the gateway…" : "Message nullclaw…"}
        aria-label="Message"
      />
      <button className="btn" type="button" onClick={submit} disabled={disabled}>
        Send
      </button>
    </div>
  );
}
