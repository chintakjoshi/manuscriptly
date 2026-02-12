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

function normalizeContentStatus(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  if (normalized === "fraft") {
    return "draft";
  }
  return normalized;
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
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

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
    setSaveNotice(null);
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
    setSaveNotice(null);
    const parsedTags = tags
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const normalizedStatus = normalizeContentStatus(status);
    const selectedTags = selectedItem.tags ?? [];

    const payload: ContentUpdateRequest = {
      change_description: "Manual edit from content workspace.",
    };

    const nextTitle = title.trim();
    if (nextTitle && nextTitle !== selectedItem.title) {
      payload.title = nextTitle;
    }

    const nextContent = content.trim();
    if (nextContent && nextContent !== selectedItem.content) {
      payload.content = nextContent;
    }

    const nextMetaDescription = metaDescription.trim() || null;
    if (nextMetaDescription !== (selectedItem.meta_description ?? null)) {
      payload.meta_description = nextMetaDescription;
    }

    const tagsChanged =
      parsedTags.length !== selectedTags.length ||
      parsedTags.some((tag, index) => tag !== selectedTags[index]);
    if (tagsChanged) {
      payload.tags = parsedTags.length > 0 ? parsedTags : null;
    }

    if (normalizedStatus && normalizedStatus !== selectedItem.status) {
      payload.status = normalizedStatus;
    }

    const hasChanges =
      payload.title !== undefined ||
      payload.content !== undefined ||
      payload.meta_description !== undefined ||
      payload.tags !== undefined ||
      payload.status !== undefined;
    if (!hasChanges) {
      setSaveNotice("No changes to save.");
      return;
    }

    try {
      await onSave(selectedItem.id, payload);
      setSaveNotice("Changes saved.");
      if (payload.status) {
        setStatus(payload.status);
      }
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
            onChange={(event) => {
              setTitle(event.target.value);
              setSaveNotice(null);
            }}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            placeholder="Content title"
          />
          <textarea
            value={metaDescription}
            onChange={(event) => {
              setMetaDescription(event.target.value);
              setSaveNotice(null);
            }}
            rows={2}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            placeholder="Meta description"
          />
          <input
            type="text"
            value={tags}
            onChange={(event) => {
              setTags(event.target.value);
              setSaveNotice(null);
            }}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            placeholder="Tags (comma-separated)"
          />
          <input
            type="text"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setSaveNotice(null);
            }}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-900"
            placeholder="Status"
          />
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setSaveNotice(null);
            }}
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

        {saveNotice ? <p className="mt-3 rounded-md bg-emerald-100 px-3 py-2 text-xs text-emerald-700">{saveNotice}</p> : null}
        {error ? <p className="mt-3 rounded-md bg-rose-100 px-3 py-2 text-xs text-rose-700">{error}</p> : null}
      </article>
    </div>
  );
}
