export type ToolRunStatus = "running" | "completed" | "failed";

export type ToolRun = {
  toolUseId: string;
  toolName: string;
  iteration: number;
  status: ToolRunStatus;
  details?: string;
  error?: string;
};

type ToolActivityPhase = "idle" | "thinking" | "tools" | "completed" | "failed";

type ToolActivityIndicatorProps = {
  phase: ToolActivityPhase;
  summary: string;
  expectedToolCount: number;
  tools: ToolRun[];
};

export function ToolActivityIndicator({ phase, summary, expectedToolCount, tools }: ToolActivityIndicatorProps) {
  if (phase === "idle" && tools.length === 0) {
    return null;
  }

  const completedTools = tools.filter((tool) => tool.status === "completed").length;
  const failedTools = tools.filter((tool) => tool.status === "failed").length;
  const finishedTools = completedTools + failedTools;
  const totalTools = Math.max(expectedToolCount, tools.length);
  const progressPercent = totalTools > 0 ? Math.round((finishedTools / totalTools) * 100) : phase === "completed" ? 100 : 0;

  const statusChipClass =
    phase === "failed"
      ? "bg-rose-100 text-rose-700"
      : phase === "completed"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-amber-100 text-amber-700";

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-700">Agent Activity</p>
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusChipClass}`}>{summary}</span>
      </div>

      {phase === "thinking" && (
        <p className="mt-2 text-sm text-slate-600">
          Agent is thinking<span className="animate-pulse">...</span>
        </p>
      )}

      {totalTools > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
            <span>Tool Progress</span>
            <span>
              {finishedTools}/{totalTools}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-200">
            <div
              className={`h-2 rounded-full transition-all ${phase === "failed" ? "bg-rose-500" : "bg-emerald-500"}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {tools.length > 0 && (
        <ul className="mt-3 space-y-2">
          {tools.map((tool) => {
            const badgeClass =
              tool.status === "failed"
                ? "bg-rose-100 text-rose-700"
                : tool.status === "completed"
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-amber-100 text-amber-700";
            return (
              <li key={`${tool.toolUseId}-${tool.iteration}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-900">{tool.toolName}</p>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>{tool.status}</span>
                </div>
                {tool.details && <p className="mt-1 text-xs text-slate-600">{tool.details}</p>}
                {tool.error && <p className="mt-1 text-xs text-rose-700">{tool.error}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {phase === "completed" && failedTools === 0 && totalTools > 0 && (
        <p className="mt-2 text-xs text-emerald-700">All tool calls completed successfully.</p>
      )}
      {failedTools > 0 && <p className="mt-2 text-xs text-rose-700">Some tool calls failed. Check details above.</p>}
    </div>
  );
}

export type { ToolActivityPhase };
