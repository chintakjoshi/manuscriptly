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
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;

  if (sessions.length === 0) {
    return (
      <div className="flex h-full min-h-0 flex-col px-3 py-5 text-xs text-[var(--text-secondary)]">
        <p className="flex-1">No sessions yet.</p>
        <div className="mt-3 flex-none border-t border-[#2d3441] pt-2">
          <p className="font-semibold text-[var(--text-primary)]">Active Session</p>
          <p className="mt-1 text-[var(--text-tertiary)]">None selected</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {sessions.map((session) => {
          const active = session.id === activeSessionId;
          return (
            <li key={session.id}>
              <button
                type="button"
                onClick={() => onSelectSession(session.id)}
                className={`w-full rounded-xl px-3 py-3 text-left transition ${
                  active
                    ? "bg-[#2d3441] text-[var(--text-primary)]"
                    : "bg-transparent text-[var(--text-primary)] hover:bg-[#242a35]"
                }`}
              >
                <p className="truncate text-sm font-semibold">{session.title || "Untitled session"}</p>
                <p className={`mt-1 text-[11px] ${active ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}`}>
                  {formatDate(session.created_at)}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex-none border-t border-[#2d3441] px-1 pt-2 text-xs text-[var(--text-secondary)]">
        <p className="font-semibold text-[var(--text-primary)]">Active Session</p>
        <p className="mt-1 truncate">{activeSession?.title || "None selected"}</p>
      </div>
    </div>
  );
}
