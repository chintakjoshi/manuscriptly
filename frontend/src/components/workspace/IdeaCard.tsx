import type { PlanDto } from "../../lib/api";

type IdeaCardProps = {
  plan: PlanDto;
  sessionTitle: string | null;
  isCurrentSession: boolean;
  starting?: boolean;
  onStartSession: (plan: PlanDto) => Promise<void>;
  onOpenSession: (sessionId: string) => void;
};

function truncate(value: string | null, maxLength: number): string {
  if (!value) {
    return "No description yet.";
  }
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

export function IdeaCard({
  plan,
  sessionTitle,
  isCurrentSession,
  starting = false,
  onStartSession,
  onOpenSession,
}: IdeaCardProps) {
  return (
    <article className="border-b border-[#2e3440] px-1 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-tertiary)]">Blog Idea</p>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{plan.title}</h3>
          <p className="mt-1 text-xs text-[var(--text-tertiary)]">Source session: {sessionTitle || "Untitled session"}</p>
        </div>
        <span className="rounded-full bg-[#2b313c] px-2 py-1 text-xs font-medium text-[var(--text-secondary)]">{plan.status}</span>
      </div>

      <p className="mt-2 text-sm text-[var(--text-secondary)]">{truncate(plan.description, 180)}</p>

      <div className="mt-2 flex flex-wrap gap-1">
        {(plan.target_keywords ?? []).slice(0, 5).map((keyword) => (
          <span key={`${plan.id}-${keyword}`} className="rounded-full bg-[#282f3a] px-2 py-1 text-xs text-[var(--text-secondary)]">
            {keyword}
          </span>
        ))}
        {(plan.target_keywords ?? []).length === 0 ? <span className="text-xs text-[var(--text-tertiary)]">No keywords</span> : null}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void onStartSession(plan)}
          disabled={starting}
          className="rounded-full bg-[var(--text-primary)] px-2.5 py-1 text-xs font-semibold text-[#101215] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[#5b616e] disabled:text-[#d2d6dd]"
        >
          {starting ? "Starting..." : "Start Session"}
        </button>
        {isCurrentSession ? null : (
          <button
            type="button"
            onClick={() => onOpenSession(plan.conversation_id)}
            className="rounded-full bg-[#2e3542] px-2.5 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[#363f4e]"
          >
            Open Source
          </button>
        )}
      </div>
    </article>
  );
}
