import type { SessionDto } from "../../lib/api";

type SessionListProps = {
  sessions: SessionDto[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function SessionList({ sessions, activeSessionId, onSelectSession }: SessionListProps) {
  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-5 text-xs text-slate-500">
        No sessions yet.
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {sessions.map((session) => {
        const active = session.id === activeSessionId;
        return (
          <li key={session.id}>
            <button
              type="button"
              onClick={() => onSelectSession(session.id)}
              className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-900 hover:border-slate-400 hover:bg-slate-50"
              }`}
            >
              <p className="truncate text-sm font-semibold">{session.title || "Untitled session"}</p>
              <p className={`mt-1 text-[11px] ${active ? "text-slate-200" : "text-slate-500"}`}>{formatDate(session.created_at)}</p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
