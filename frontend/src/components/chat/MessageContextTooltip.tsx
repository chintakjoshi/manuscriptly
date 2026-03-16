import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type MessageContextTooltipProps = {
  contextUsed: Record<string, unknown>;
  messageId: string;
};

type ContextFact = {
  label: string;
  value: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toLowerCase() === "unknown" || trimmed.toLowerCase() === "none") {
      return null;
    }
    return trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (typeof item === "string" ? item.trim() : String(item)))
      .filter((item) => item);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
}

function getListStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : null))
    .filter((entry): entry is string => Boolean(entry));
}

function getMemoryFacts(value: unknown): ContextFact[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      const row = asRecord(item);
      if (!row) {
        return null;
      }
      const label = asString(row.label) ?? asString(row.field) ?? asString(row.fact);
      const itemValue = formatValue(row.value);
      if (!label || !itemValue) {
        return null;
      }
      return { label, value: itemValue };
    })
    .filter((item): item is ContextFact => Boolean(item));
}

export function MessageContextTooltip({ contextUsed, messageId }: MessageContextTooltipProps) {
  const [open, setOpen] = useState(false);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedTrigger = buttonRef.current?.contains(target);
      const clickedPanel = panelRef.current?.contains(target);
      if (!clickedTrigger && !clickedPanel) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelPosition(null);
      return;
    }

    const updatePosition = () => {
      const button = buttonRef.current;
      if (!button) {
        return;
      }

      const rect = button.getBoundingClientRect();
      const viewportPadding = 16;
      const preferredWidth = 320;
      const maxWidth = Math.min(preferredWidth, window.innerWidth - viewportPadding * 2);
      const panelWidth = panelRef.current?.offsetWidth ?? maxWidth;
      const panelHeight = panelRef.current?.offsetHeight ?? 0;
      const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
      const spaceAbove = rect.top - viewportPadding;
      const top =
        panelHeight > 0 && spaceBelow < panelHeight + 8 && spaceAbove > spaceBelow
          ? Math.max(viewportPadding, rect.top - panelHeight - 8)
          : Math.min(window.innerHeight - viewportPadding, rect.bottom + 8);
      const left = Math.min(
        Math.max(viewportPadding, rect.right - panelWidth),
        window.innerWidth - panelWidth - viewportPadding,
      );

      setPanelPosition({ top, left });
    };

    updatePosition();
    const rafId = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  const provider = asString(contextUsed.provider);
  const model = asString(contextUsed.model);
  const toolCallsCount = asNumber(contextUsed.tool_calls_count) ?? 0;
  const toolIterations = asNumber(contextUsed.tool_iterations);
  const registeredTools = getListStrings(contextUsed.registered_tools);

  const userContext = asRecord(contextUsed.user_context);
  const memorySnapshot = asRecord(contextUsed.memory_snapshot);

  const profileFacts = useMemo<ContextFact[]>(
    () => [
      { label: "User", value: formatValue(userContext?.user_name) ?? "" },
      { label: "Company", value: formatValue(userContext?.company_name) ?? "" },
      { label: "Industry", value: formatValue(userContext?.industry) ?? "" },
      { label: "Audience", value: formatValue(userContext?.target_audience) ?? "" },
      { label: "Voice", value: formatValue(userContext?.brand_voice) ?? "" },
      { label: "Preferences", value: formatValue(userContext?.content_preferences) ?? "" },
      { label: "Extra Context", value: formatValue(userContext?.additional_context) ?? "" },
    ].filter((row) => row.value),
    [userContext],
  );

  const knownProfileFacts = getMemoryFacts(memorySnapshot?.known_profile_fields);
  const inferredFacts = getMemoryFacts(memorySnapshot?.inferred_facts);
  const sessionIntents = getListStrings(memorySnapshot?.current_session_intents);
  const crossSessionIntents = getListStrings(memorySnapshot?.cross_session_intents);

  const influenceTags = [
    profileFacts.length > 0 ? "Profile" : null,
    knownProfileFacts.length + inferredFacts.length + sessionIntents.length + crossSessionIntents.length > 0 ? "Memory" : null,
    toolCallsCount > 0 ? "Tools" : null,
  ].filter((tag): tag is string => Boolean(tag));

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-semibold text-[#8de4c8] hover:bg-[var(--accent-soft)]/80"
        aria-expanded={open}
        aria-controls={`context-popover-${messageId}`}
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="relative inline-block h-3 w-3">
          <span className="absolute left-0 top-0 h-1.5 w-1.5 rounded-full bg-emerald-300" />
          <span className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-sky-300" />
          <span className="absolute left-0 bottom-0 h-1.5 w-1.5 rounded-full bg-sky-300" />
          <span className="absolute right-0 bottom-0 h-1.5 w-1.5 rounded-full bg-emerald-300" />
        </span>
        <span>Context DNA</span>
      </button>

      {open &&
        createPortal(
          <aside
            ref={panelRef}
            id={`context-popover-${messageId}`}
            className="fixed z-[120] w-[320px] max-w-[calc(100vw-2rem)] rounded-2xl bg-[#212833] p-3 text-xs text-[var(--text-secondary)] shadow-2xl"
            style={
              panelPosition
                ? {
                    top: `${panelPosition.top}px`,
                    left: `${panelPosition.left}px`,
                  }
                : { visibility: "hidden" }
            }
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-[var(--text-primary)]">Response Context</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md bg-[#2a313d] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[#313a48]"
              >
                Close
              </button>
            </div>

            {influenceTags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {influenceTags.map((tag) => (
                  <span key={tag} className="rounded-full bg-[#2b3340] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-secondary)]">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {(provider || model) && (
              <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
                {provider ?? "provider"}
                {model ? ` - ${model}` : ""}
              </p>
            )}

            {profileFacts.length > 0 && (
              <section className="mt-3">
                <p className="font-semibold text-[var(--text-primary)]">User Context Used</p>
                <ul className="mt-1 space-y-1">
                  {profileFacts.map((fact) => (
                    <li key={`profile-${fact.label}`}>
                      <span className="font-medium text-[var(--text-primary)]">{fact.label}:</span> {fact.value}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(knownProfileFacts.length > 0 || inferredFacts.length > 0) && (
              <section className="mt-3">
                <p className="font-semibold text-[var(--text-primary)]">Memory Signals</p>
                <ul className="mt-1 space-y-1">
                  {knownProfileFacts.map((fact) => (
                    <li key={`known-${fact.label}-${fact.value}`}>
                      <span className="font-medium text-[var(--text-primary)]">{fact.label}:</span> {fact.value}
                    </li>
                  ))}
                  {inferredFacts.map((fact) => (
                    <li key={`inferred-${fact.label}-${fact.value}`}>
                      <span className="font-medium text-[var(--text-primary)]">{fact.label}:</span> {fact.value}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {(sessionIntents.length > 0 || crossSessionIntents.length > 0) && (
              <section className="mt-3">
                <p className="font-semibold text-[var(--text-primary)]">Intent Memory</p>
                <ul className="mt-1 space-y-1">
                  {sessionIntents.map((intent) => (
                    <li key={`session-intent-${intent}`}>{intent}</li>
                  ))}
                  {crossSessionIntents.map((intent) => (
                    <li key={`cross-intent-${intent}`}>{intent}</li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-3 border-t border-[#323949] pt-2 text-[11px] text-[var(--text-secondary)]">
              <p>
                Tool calls in this response: <span className="font-semibold text-[var(--text-primary)]">{toolCallsCount}</span>
              </p>
              {toolIterations ? (
                <p>
                  Tool loop iterations: <span className="font-semibold text-[var(--text-primary)]">{toolIterations}</span>
                </p>
              ) : null}
              {registeredTools.length > 0 ? (
                <p className="mt-1">Available tools: {registeredTools.join(", ")}</p>
              ) : null}
            </section>
          </aside>,
          document.body,
        )}
    </div>
  );
}
