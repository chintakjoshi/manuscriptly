import { useEffect, useMemo, useState } from "react";

import type { ContentItemDto, ContentUpdateRequest } from "../../lib/api";

type ContentDisplayProps = {
  contentItems: ContentItemDto[];
  selectedContentId: string | null;
  onSelectContent: (contentItemId: string) => void;
  onSave: (contentItemId: string, payload: ContentUpdateRequest) => Promise<void>;
  onRegenerate: (contentItemId: string, writingInstructions: string | null) => Promise<void>;
  savingContentId?: string | null;
  regeneratingContentId?: string | null;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function ContentDisplay({
  contentItems,
  selectedContentId,
  onSelectContent,
  onSave,
  onRegenerate,
  savingContentId = null,
  regeneratingContentId = null,
}: ContentDisplayProps) {
  const selectedItem = useMemo(() => {
    if (contentItems.length === 0) {
      return null;
    }
    if (selectedContentId) {
      const matched = contentItems.find((item) => item.id === selectedContentId);
      if (matched) {
        return matched;
      }
    }
    return contentItems[0];
  }, [contentItems, selectedContentId]);

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedItem) {
      setTitle("");
      setContent("");
      setMetaDescription("");
      setTags("");
      setStatus("");
      return;
    }
    setTitle(selectedItem.title);
    setContent(selectedItem.content);
    setMetaDescription(selectedItem.meta_description ?? "");
    setTags((selectedItem.tags ?? []).join(", "));
    setStatus(selectedItem.status);
    setError(null);
  }, [selectedItem?.id]);

  if (contentItems.length === 0 || !selectedItem) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
        No generated content yet. Execute a plan to create a draft.
      </div>
    );
  }

  const handleSave = async () => {
    setError(null);
    const parsedTags = tags
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    try {
      await onSave(selectedItem.id, {
        title: title.trim() || selectedItem.title,
        content: content.trim() || selectedItem.content,
        meta_description: metaDescription.trim() || null,
        tags: parsedTags.length > 0 ? parsedTags : null,
        status: status.trim() || selectedItem.status,
        change_description: "Manual edit from content workspace.",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save content.");
    }
  };

  const handleRegenerate = async () => {
    const confirmed = window.confirm("Regenerate this draft from its plan?");
    if (!confirmed) {
      return;
    }
    const instructions = window.prompt(
      "Optional: add writing instructions for this regeneration.",
      "Keep the same structure but strengthen examples and clarity.",
    );
    setError(null);
    try {
      await onRegenerate(selectedItem.id, instructions?.trim() || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate content.");
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Drafts</p>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {contentItems.map((item) => {
            const active = item.id === selectedItem.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectContent(item.id)}
                className={`min-w-[180px] rounded-lg border px-3 py-2 text-left ${
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"
                }`}
              >
                <p className="truncate text-xs font-semibold">{item.title}</p>
                <p className={`mt-1 text-[11px] ${active ? "text-slate-200" : "text-slate-500"}`}>
                  v{item.version} - {formatDate(item.updated_at)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-slate-900">Content Preview & Edit</h3>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
            {content.trim().split(/\s+/).filter(Boolean).length} words
          </span>
        </div>

        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            placeholder="Content title"
          />
          <textarea
            value={metaDescription}
            onChange={(event) => setMetaDescription(event.target.value)}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            placeholder="Meta description"
          />
          <input
            type="text"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            placeholder="Tags (comma-separated)"
          />
          <input
            type="text"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            placeholder="Status"
          />
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            rows={16}
            className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-slate-900"
            placeholder="Generated content"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={savingContentId === selectedItem.id}
            className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {savingContentId === selectedItem.id ? "Saving..." : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={() => void handleRegenerate()}
            disabled={regeneratingContentId === selectedItem.id}
            className="rounded-md border border-indigo-300 px-3 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {regeneratingContentId === selectedItem.id ? "Regenerating..." : "Regenerate"}
          </button>
        </div>

        {error ? <p className="mt-3 rounded-md bg-rose-100 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
      </article>
    </div>
  );
}
