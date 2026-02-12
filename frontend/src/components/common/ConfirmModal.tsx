import { useEffect } from "react";

type ConfirmModalTone = "neutral" | "danger" | "success";

type ConfirmModalProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmModalTone;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  inputLabel?: string;
  inputPlaceholder?: string;
  inputValue?: string;
  onInputChange?: (value: string) => void;
  inputRows?: number;
};

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "neutral",
  loading = false,
  onConfirm,
  onCancel,
  inputLabel,
  inputPlaceholder,
  inputValue,
  onInputChange,
  inputRows = 3,
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) {
        onCancel();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [loading, onCancel, open]);

  if (!open) {
    return null;
  }

  const confirmButtonClass =
    tone === "danger"
      ? "bg-[#4a1f2a] text-rose-100 hover:bg-[#5b2431]"
      : tone === "success"
        ? "bg-[#1e3a32] text-emerald-100 hover:bg-[#25473d]"
        : "bg-[var(--text-primary)] text-[#101215] hover:opacity-90";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0c0f14]/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl bg-[#1d232d] shadow-2xl">
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{message}</p>
            </div>
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="rounded-full bg-[#2c3442] px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[#364053] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Close
            </button>
          </div>

          {inputValue !== undefined && onInputChange ? (
            <label className="block text-xs text-[var(--text-secondary)]">
              {inputLabel || "Additional input"}
              <textarea
                value={inputValue}
                onChange={(event) => onInputChange(event.target.value)}
                rows={inputRows}
                placeholder={inputPlaceholder}
                disabled={loading}
                className="mt-1 w-full rounded-xl bg-[#2a313d] px-3 py-2 text-sm text-[var(--text-primary)] outline-none disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>
          ) : null}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="rounded-full bg-[#2c3442] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[#364053] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className={`rounded-full px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${confirmButtonClass}`}
            >
              {loading ? "Working..." : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
