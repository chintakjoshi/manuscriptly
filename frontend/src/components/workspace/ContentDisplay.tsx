type GeneratedContentItem = {
  id: string;
  title: string;
  content: string;
  word_count: number | null;
  tags: string[] | null;
  meta_description: string | null;
  created_at: string | null;
};

type ContentDisplayProps = {
  contentItem: GeneratedContentItem | null;
};

function formatDate(value: string | null): string {
  if (!value) {
    return "Unknown date";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function ContentDisplay({ contentItem }: ContentDisplayProps) {
  if (!contentItem) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
        No generated content yet. Ask the agent to execute a plan.
      </div>
    );
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">{contentItem.title}</h3>
        <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
          {contentItem.word_count ?? 0} words
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{formatDate(contentItem.created_at)}</p>
      {contentItem.meta_description && (
        <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{contentItem.meta_description}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-1">
        {(contentItem.tags ?? []).length === 0 && <span className="text-xs text-slate-500">No tags</span>}
        {(contentItem.tags ?? []).map((tag) => (
          <span key={tag} className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700">
            {tag}
          </span>
        ))}
      </div>
      <div className="mt-3 max-h-[48vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
        <pre className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{contentItem.content}</pre>
      </div>
    </article>
  );
}

export type { GeneratedContentItem };
