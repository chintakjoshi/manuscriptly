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
      ? "bg-rose-500/20 text-rose-200"
      : phase === "completed"
        ? "bg-emerald-500/20 text-emerald-200"
        : "bg-amber-500/20 text-amber-200";

  return (
    <div className="mt-2 w-full border-t border-[#2e3440] px-3 pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-[var(--text-tertiary)]">Agent Activity</p>
        <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusChipClass}`}>{summary}</span>
      </div>

      {phase === "thinking" && (
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          Agent is thinking<span className="animate-pulse">...</span>
        </p>
      )}

      {totalTools > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-tertiary)]">
            <span>Tool Progress</span>
            <span>
              {finishedTools}/{totalTools}
            </span>
          </div>
          <div className="h-2 rounded-full bg-[#2a313d]">
            <div
              className={`h-2 rounded-full transition-all ${phase === "failed" ? "bg-rose-400" : "bg-emerald-400"}`}
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
                ? "bg-rose-500/20 text-rose-200"
                : tool.status === "completed"
                  ? "bg-emerald-500/20 text-emerald-200"
                  : "bg-amber-500/20 text-amber-200";
            return (
              <li key={`${tool.toolUseId}-${tool.iteration}`} className="border-b border-[#2e3440] px-1 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{tool.toolName}</p>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${badgeClass}`}>{tool.status}</span>
                </div>
                {tool.details && <p className="mt-1 text-xs text-[var(--text-secondary)]">{tool.details}</p>}
                {tool.error && <p className="mt-1 text-xs text-rose-300">{tool.error}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {phase === "completed" && failedTools === 0 && totalTools > 0 && (
        <p className="mt-2 text-xs text-emerald-300">All tool calls completed successfully.</p>
      )}
      {failedTools > 0 && <p className="mt-2 text-xs text-rose-300">Some tool calls failed. Check details above.</p>}
    </div>
  );
}

export type { ToolActivityPhase };
