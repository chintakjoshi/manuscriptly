import { useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";

type ChatInputProps = {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  loading?: boolean;
};

export function ChatInput({ onSend, disabled = false, loading = false }: ChatInputProps) {
  const [value, setValue] = useState("");

  const submitCurrentValue = async () => {
    const trimmed = value.trim();
    if (!trimmed || disabled || loading) {
      return;
    }
    setValue("");
    await onSend(trimmed);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitCurrentValue();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const isEnter = event.key === "Enter";
    const wantsNewLine = event.shiftKey;
    if (!isEnter || wantsNewLine) {
      return;
    }

    event.preventDefault();
    void submitCurrentValue();
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="pb-2 pt-3 sm:pb-4">
      <label htmlFor="chat-input" className="sr-only">
        Message
      </label>
      <div className="flex w-full items-end gap-2 rounded-3xl bg-black p-2">
        <textarea
          id="chat-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything about your next blog..."
          disabled={disabled || loading}
          rows={2}
          className="min-h-[52px] max-h-40 flex-1 resize-y bg-transparent px-1 py-2 text-[15px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || loading || value.trim().length === 0}
          aria-label="Send message"
          className="flex h-9 w-9 shrink-0 items-center justify-center self-end rounded-full bg-[var(--text-primary)] text-lg font-semibold leading-none text-[#101215] transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
        >
          {loading ? "\u2026" : "\u2191"}
        </button>
      </div>
      <p className="mt-2 w-full px-2 text-[11px] text-[var(--text-tertiary)]">
        Enter to send. Shift+Enter for newline.
      </p>
    </form>
  );
}

