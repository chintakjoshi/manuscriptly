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
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Blog Idea</p>
          <h3 className="text-sm font-semibold text-slate-900">{plan.title}</h3>
          <p className="mt-1 text-xs text-slate-500">Source session: {sessionTitle || "Untitled session"}</p>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{plan.status}</span>
      </div>

      <p className="mt-2 text-sm text-slate-700">{truncate(plan.description, 180)}</p>

      <div className="mt-2 flex flex-wrap gap-1">
        {(plan.target_keywords ?? []).slice(0, 5).map((keyword) => (
          <span key={`${plan.id}-${keyword}`} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
            {keyword}
          </span>
        ))}
        {(plan.target_keywords ?? []).length === 0 ? <span className="text-xs text-slate-500">No keywords</span> : null}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => void onStartSession(plan)}
          disabled={starting}
          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {starting ? "Starting..." : "Start Session"}
        </button>
        {isCurrentSession ? null : (
          <button
            type="button"
            onClick={() => onOpenSession(plan.conversation_id)}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Open Source
          </button>
        )}
      </div>
    </article>
  );
}
