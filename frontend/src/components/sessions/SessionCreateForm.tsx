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
    <form onSubmit={(event) => void handleSubmit(event)} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Create Session</p>
      <label className="block text-xs text-slate-600" htmlFor="session-title">
        Title
      </label>
      <input
        id="session-title"
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="Optional session title"
        disabled={loading || disabled}
        className="w-full rounded-lg border border-slate-300 px-2 py-2 text-xs outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
      />
      <button
        type="submit"
        disabled={loading || disabled}
        className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
      >
        {loading ? "Creating..." : "Create Session"}
      </button>
    </form>
  );
}
