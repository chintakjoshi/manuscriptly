import { useEffect, useMemo, useState } from "react";
import rehypeHighlight from "rehype-highlight";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { ConfirmModal } from "../common/ConfirmModal";
import type { ContentItemDto, ContentUpdateRequest } from "../../lib/api";

type ViewMode = "preview" | "edit";

const DEFAULT_REGENERATE_INSTRUCTIONS = "Keep the same structure but strengthen examples and clarity.";

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

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/g, "").replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildFileBaseName(title: string, version: number): string {
  const stem = slugify(title.trim()) || "blog-draft";
  return `${stem}-v${version}`;
}

function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const helper = document.createElement("textarea");
  helper.value = text;
  helper.setAttribute("readonly", "true");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  const succeeded = document.execCommand("copy");
  helper.remove();
  if (!succeeded) {
    throw new Error("Clipboard copy failed.");
  }
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

  const [viewMode, setViewMode] = useState<ViewMode>("preview");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [tags, setTags] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false);
  const [regenerateInstructions, setRegenerateInstructions] = useState(DEFAULT_REGENERATE_INSTRUCTIONS);

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
    setActionNotice(null);
    setIsRegenerateModalOpen(false);
    setRegenerateInstructions(DEFAULT_REGENERATE_INSTRUCTIONS);
  }, [selectedItem?.id]);

  const plainTextContent = useMemo(() => toPlainText(content), [content]);

  if (contentItems.length === 0 || !selectedItem) {
    return (
      <div className="px-2 py-8 text-sm text-[var(--text-secondary)]">
        No generated content yet. Execute a plan to create a draft.
      </div>
    );
  }

  const clearNotices = () => {
    setSaveNotice(null);
    setActionNotice(null);
  };

  const handleSave = async () => {
    setError(null);
    setSaveNotice(null);
    setActionNotice(null);
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

  const openRegenerateModal = () => {
    setRegenerateInstructions(DEFAULT_REGENERATE_INSTRUCTIONS);
    setIsRegenerateModalOpen(true);
  };

  const handleRegenerate = async () => {
    setError(null);
    setSaveNotice(null);
    setActionNotice(null);
    try {
      await onRegenerate(selectedItem.id, regenerateInstructions.trim() || null);
      setIsRegenerateModalOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate content.");
    }
  };

  const handleCopyMarkdown = async () => {
    const markdownContent = content.trim();
    if (!markdownContent) {
      setError("There is no markdown content to copy.");
      return;
    }
    setError(null);
    setSaveNotice(null);
    try {
      await copyTextToClipboard(markdownContent);
      setActionNotice("Markdown copied to clipboard.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy markdown.");
    }
  };

  const handleCopyPlainText = async () => {
    if (!plainTextContent) {
      setError("There is no plain text content to copy.");
      return;
    }
    setError(null);
    setSaveNotice(null);
    try {
      await copyTextToClipboard(plainTextContent);
      setActionNotice("Plain text copied to clipboard.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy plain text.");
    }
  };

  const handleExportMarkdown = () => {
    const markdownContent = content.trim();
    if (!markdownContent) {
      setError("There is no markdown content to export.");
      return;
    }
    const fileName = `${buildFileBaseName(title || selectedItem.title, selectedItem.version)}.md`;
    downloadTextFile(fileName, markdownContent, "text/markdown;charset=utf-8");
    setError(null);
    setSaveNotice(null);
    setActionNotice(`Downloaded ${fileName}.`);
  };

  const handleExportPlainText = () => {
    if (!plainTextContent) {
      setError("There is no plain text content to export.");
      return;
    }
    const fileName = `${buildFileBaseName(title || selectedItem.title, selectedItem.version)}.txt`;
    downloadTextFile(fileName, plainTextContent, "text/plain;charset=utf-8");
    setError(null);
    setSaveNotice(null);
    setActionNotice(`Downloaded ${fileName}.`);
  };

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-3 xl:flex xl:h-full xl:min-h-0 xl:flex-col">
      <div className="border-b border-[#2e3440] px-1 pb-3">
        <div className="flex items-center justify-between gap-2">
          <p className="rounded-full bg-[#2b2436] px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-200">
            Drafts
          </p>
          <span className="rounded-full bg-[#2b2436] px-2 py-1 text-[11px] font-semibold text-violet-200">
            {contentItems.length} draft{contentItems.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {contentItems.map((item) => {
            const active = item.id === selectedItem.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectContent(item.id)}
                className={`min-w-[180px] rounded-lg px-3 py-2 text-left ${
                  active
                    ? "bg-[#313947] text-[var(--text-primary)]"
                    : "bg-transparent text-[var(--text-secondary)] hover:bg-[#2a313d]"
                }`}
              >
                <p className="truncate text-xs font-semibold">{item.title}</p>
                <p className={`mt-1 text-[11px] ${active ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}`}>
                  v{item.version} - {formatDate(item.updated_at)}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <article className="px-1 py-1 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-[var(--text-primary)]">Content Preview & Edit</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-full bg-[#2a313d] p-1">
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  viewMode === "preview" ? "bg-[var(--text-primary)] text-[#111318]" : "text-[var(--text-secondary)] hover:bg-[#343c4c]"
                }`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setViewMode("edit")}
                className={`rounded-full px-2 py-1 text-xs font-semibold ${
                  viewMode === "edit" ? "bg-[var(--text-primary)] text-[#111318]" : "text-[var(--text-secondary)] hover:bg-[#343c4c]"
                }`}
              >
                Edit Markdown
              </button>
            </div>
            <span className="rounded-full bg-[#2f3643] px-2 py-1 text-xs font-medium text-[var(--text-secondary)]">{wordCount} words</span>
          </div>
        </div>

        <div className="mt-3 space-y-2 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
          <input
            type="text"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              clearNotices();
            }}
            className="w-full rounded-xl bg-[#2a313d] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            placeholder="Content title"
          />
          <textarea
            value={metaDescription}
            onChange={(event) => {
              setMetaDescription(event.target.value);
              clearNotices();
            }}
            rows={2}
            className="w-full rounded-xl bg-[#2a313d] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            placeholder="Meta description"
          />
          <input
            type="text"
            value={tags}
            onChange={(event) => {
              setTags(event.target.value);
              clearNotices();
            }}
            className="w-full rounded-xl bg-[#2a313d] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            placeholder="Tags (comma-separated)"
          />
          <input
            type="text"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              clearNotices();
            }}
            className="w-full rounded-xl bg-[#2a313d] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
            placeholder="Status"
          />
          {viewMode === "edit" ? (
            <textarea
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                clearNotices();
              }}
              rows={20}
              className="min-h-[320px] w-full rounded-xl bg-[#1f2530] px-3 py-2 font-mono text-xs leading-relaxed text-[var(--text-primary)] outline-none xl:min-h-0 xl:flex-1"
              placeholder="Generated markdown content"
            />
          ) : (
            <div className="min-h-[320px] overflow-y-auto rounded-xl bg-[#1c212b] px-4 py-3 xl:min-h-0 xl:flex-1">
              {content.trim() ? (
                <div className="markdown-preview text-sm text-[var(--text-secondary)]">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
                  >
                    {content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-[var(--text-tertiary)]">No content to preview yet.</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={savingContentId === selectedItem.id}
            className="rounded-full bg-[var(--text-primary)] px-3 py-1.5 text-xs font-semibold text-[#101215] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
          >
            {savingContentId === selectedItem.id ? "Saving..." : "Save Changes"}
          </button>
          <button
            type="button"
            onClick={openRegenerateModal}
            disabled={regeneratingContentId === selectedItem.id}
            className="rounded-full bg-[#193029] px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-[#214036] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {regeneratingContentId === selectedItem.id ? "Regenerating..." : "Regenerate"}
          </button>
          <button
            type="button"
            onClick={() => void handleCopyMarkdown()}
            className="rounded-full bg-[#2e3542] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[#384153]"
          >
            Copy Markdown
          </button>
          <button
            type="button"
            onClick={() => void handleCopyPlainText()}
            className="rounded-full bg-[#2e3542] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[#384153]"
          >
            Copy Text
          </button>
          <button
            type="button"
            onClick={handleExportMarkdown}
            className="rounded-full bg-[#213a33] px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-[#28473f]"
          >
            Export .md
          </button>
          <button
            type="button"
            onClick={handleExportPlainText}
            className="rounded-full bg-[#213a33] px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-[#28473f]"
          >
            Export .txt
          </button>
        </div>

        {saveNotice ? <p className="mt-3 rounded-xl bg-[#203a31] px-3 py-2 text-xs text-emerald-200">{saveNotice}</p> : null}
        {actionNotice ? <p className="mt-3 rounded-xl bg-[#1f3442] px-3 py-2 text-xs text-sky-200">{actionNotice}</p> : null}
        {error ? <p className="mt-3 rounded-xl bg-[#3d2430] px-3 py-2 text-xs text-rose-200">{error}</p> : null}
      </article>
      <ConfirmModal
        open={isRegenerateModalOpen}
        title="Regenerate draft?"
        message="This will create a fresh version from the plan. You can optionally add writing instructions below."
        confirmLabel="Regenerate Draft"
        tone="success"
        loading={regeneratingContentId === selectedItem.id}
        onConfirm={() => void handleRegenerate()}
        onCancel={() => setIsRegenerateModalOpen(false)}
        inputLabel="Writing instructions (optional)"
        inputPlaceholder="Keep structure, improve clarity, add local examples..."
        inputValue={regenerateInstructions}
        onInputChange={setRegenerateInstructions}
        inputRows={4}
      />
    </div>
  );
}
