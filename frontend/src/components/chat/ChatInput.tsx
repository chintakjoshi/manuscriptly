import { useState } from "react";
import type { FormEvent } from "react";

type ChatInputProps = {
  onSend: (content: string) => Promise<void>;
  disabled?: boolean;
  loading?: boolean;
};

export function ChatInput({ onSend, disabled = false, loading = false }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled || loading) {
      return;
    }

    setValue("");
    await onSend(trimmed);
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="mt-4">
      <label htmlFor="chat-input" className="sr-only">
        Message
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="chat-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Describe the content you want to create..."
          disabled={disabled || loading}
          rows={3}
          className="min-h-[78px] flex-1 resize-y rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-1 focus:ring-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
        <button
          type="submit"
          disabled={disabled || loading || value.trim().length === 0}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {loading ? "Sending..." : "Send"}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">Press Enter for newline. Click Send to submit.</p>
    </form>
  );
}
