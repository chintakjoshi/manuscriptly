import { useState } from "react";
import type { FormEvent } from "react";

type SessionCreateFormProps = {
  disabled?: boolean;
  onCreate: (title: string) => Promise<void>;
  loading?: boolean;
};

export function SessionCreateForm({ disabled = false, onCreate, loading = false }: SessionCreateFormProps) {
  const [title, setTitle] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || disabled) {
      return;
    }
    await onCreate(title.trim());
    setTitle("");
  };

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-2 px-1 py-2">
      <input
        id="session-title"
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Optional session title"
        disabled={loading || disabled}
        className="w-full rounded-xl bg-[#252b36] px-3 py-2 text-xs text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:bg-[#2e3542]"
      />
      <button
        type="submit"
        disabled={loading || disabled}
        className="w-full rounded-xl bg-[var(--text-primary)] px-3 py-2 text-xs font-semibold text-[#101215] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
      >
        {loading ? "Creating..." : "Create Session"}
      </button>
    </form>
  );
}
