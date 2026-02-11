import { useEffect, useState } from "react";

import type { PlanDto, PlanUpdateRequest } from "../../lib/api";

type PlanCardProps = {
  plan: PlanDto;
  onSave: (planId: string, payload: PlanUpdateRequest) => Promise<void>;
  onDelete: (planId: string) => Promise<void>;
  onExecute?: (plan: PlanDto) => Promise<void>;
  saving?: boolean;
  deleting?: boolean;
  executing?: boolean;
};

export function PlanCard({
  plan,
  onSave,
  onDelete,
  onExecute,
  saving = false,
  deleting = false,
  executing = false,
}: PlanCardProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(plan.title);
  const [description, setDescription] = useState(plan.description ?? "");
  const [keywords, setKeywords] = useState((plan.target_keywords ?? []).join(", "));
  const [outlineJson, setOutlineJson] = useState(JSON.stringify(plan.outline ?? {}, null, 2));
  const [researchNotes, setResearchNotes] = useState(plan.research_notes ?? "");
  const [status, setStatus] = useState(plan.status);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      return;
    }
    setTitle(plan.title);
    setDescription(plan.description ?? "");
    setKeywords((plan.target_keywords ?? []).join(", "));
    setOutlineJson(JSON.stringify(plan.outline ?? {}, null, 2));
    setResearchNotes(plan.research_notes ?? "");
    setStatus(plan.status);
  }, [editing, plan]);

  const handleSave = async () => {
    setError(null);
    const parsedKeywords = keywords
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    let parsedOutline: Record<string, unknown> | undefined;
    try {
      parsedOutline = JSON.parse(outlineJson);
      if (!parsedOutline || typeof parsedOutline !== "object" || Array.isArray(parsedOutline)) {
        setError("Outline must be a valid JSON object.");
        return;
      }
    } catch {
      setError("Outline must be valid JSON.");
      return;
    }

    try {
      await onSave(plan.id, {
        title: title.trim() || plan.title,
        description: description.trim() || null,
        target_keywords: parsedKeywords.length > 0 ? parsedKeywords : null,
        outline: parsedOutline,
        research_notes: researchNotes.trim() || null,
        status: status.trim() || "draft",
      });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update plan.");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Delete this plan? This will also remove linked content.")) {
      return;
    }
    setError(null);
    try {
      await onDelete(plan.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete plan.");
    }
  };

  const handleExecute = async () => {
    if (!onExecute) {
      return;
    }
    const confirmation = window.confirm(
      plan.status === "executed"
        ? "This plan already has generated content. Execute again and generate a new draft?"
        : "Execute this plan and generate full blog content now?",
    );
    if (!confirmation) {
      return;
    }
    setError(null);
    try {
      await onExecute(plan);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute plan.");
    }
  };

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Plan</p>
          <h3 className="text-sm font-semibold text-slate-900">{plan.title}</h3>
        </div>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">{plan.status}</span>
      </div>

      {!editing ? (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{plan.description || "No description."}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {(plan.target_keywords ?? []).length === 0 && <span className="text-xs text-slate-500">No keywords</span>}
            {(plan.target_keywords ?? []).map((keyword) => (
              <span key={keyword} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
                {keyword}
              </span>
            ))}
          </div>
          <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{plan.research_notes || "No research notes."}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Edit
            </button>
            {onExecute ? (
              <button
                type="button"
                onClick={() => void handleExecute()}
                disabled={executing}
                className="rounded-md border border-indigo-300 px-2 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {executing ? "Executing..." : "Execute Plan"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="rounded-md border border-rose-300 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900"
            placeholder="Plan title"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900"
            placeholder="Description"
          />
          <input
            type="text"
            value={keywords}
            onChange={(event) => setKeywords(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900"
            placeholder="Keywords (comma-separated)"
          />
          <textarea
            value={outlineJson}
            onChange={(event) => setOutlineJson(event.target.value)}
            rows={8}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 font-mono text-xs outline-none focus:border-slate-900"
            placeholder='Outline JSON, for example {"sections":[{"heading":"Intro","key_points":["Point A"]}]}'
          />
          <textarea
            value={researchNotes}
            onChange={(event) => setResearchNotes(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900"
            placeholder="Research notes"
          />
          <input
            type="text"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-slate-900"
            placeholder="Status"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 rounded-md bg-rose-100 px-2 py-1 text-xs text-rose-700">{error}</p>}
    </article>
  );
}
