import { useEffect, useState } from "react";
import type { FormEvent } from "react";

export type OnboardingFormValues = {
  userName: string;
  companyName: string;
  industry: string;
  targetAudience: string;
  brandVoice: string;
  additionalContext: string;
};

type OnboardingModalProps = {
  open: boolean;
  loading?: boolean;
  canDismiss?: boolean;
  initialValues?: Partial<OnboardingFormValues>;
  onSubmit: (values: OnboardingFormValues) => Promise<void>;
  onClose?: () => void;
};

const EMPTY_VALUES: OnboardingFormValues = {
  userName: "",
  companyName: "",
  industry: "",
  targetAudience: "",
  brandVoice: "",
  additionalContext: "",
};

export function OnboardingModal({
  open,
  loading = false,
  canDismiss = false,
  initialValues,
  onSubmit,
  onClose,
}: OnboardingModalProps) {
  const [values, setValues] = useState<OnboardingFormValues>(EMPTY_VALUES);

  useEffect(() => {
    if (!open) {
      return;
    }
    setValues({
      userName: initialValues?.userName ?? "",
      companyName: initialValues?.companyName ?? "",
      industry: initialValues?.industry ?? "",
      targetAudience: initialValues?.targetAudience ?? "",
      brandVoice: initialValues?.brandVoice ?? "",
      additionalContext: initialValues?.additionalContext ?? "",
    });
  }, [initialValues, open]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading || !values.userName.trim()) {
      return;
    }
    await onSubmit(values);
  };

  const updateField = (field: keyof OnboardingFormValues, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0c0f14]/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-3xl bg-[#1d232d] shadow-2xl">
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Setup your writer profile</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                This context is saved and injected into the agent prompt automatically.
              </p>
            </div>
            {canDismiss && onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-[#2c3442] px-2 py-1 text-xs font-medium text-[var(--text-secondary)] hover:bg-[#364053]"
              >
                Close
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-[var(--text-secondary)]">
              Name
              <input
                type="text"
                value={values.userName}
                onChange={(event) => updateField("userName", event.target.value)}
                placeholder="Your name"
                className="mt-1 w-full rounded-xl bg-[#2a313d] px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
                required
              />
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              Company
              <input
                type="text"
                value={values.companyName}
                onChange={(event) => updateField("companyName", event.target.value)}
                placeholder="Company name"
                className="mt-1 w-full rounded-xl bg-[#2a313d] px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              Industry
              <input
                type="text"
                value={values.industry}
                onChange={(event) => updateField("industry", event.target.value)}
                placeholder="e.g. SaaS, Ecommerce"
                className="mt-1 w-full rounded-xl bg-[#2a313d] px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </label>
            <label className="text-xs text-[var(--text-secondary)]">
              Brand voice
              <input
                type="text"
                value={values.brandVoice}
                onChange={(event) => updateField("brandVoice", event.target.value)}
                placeholder="e.g. Practical and confident"
                className="mt-1 w-full rounded-xl bg-[#2a313d] px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
              />
            </label>
          </div>

          <label className="block text-xs text-[var(--text-secondary)]">
            Target audience
            <textarea
              value={values.targetAudience}
              onChange={(event) => updateField("targetAudience", event.target.value)}
              rows={2}
              placeholder="Who are you writing for?"
              className="mt-1 w-full rounded-xl bg-[#2a313d] px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>

          <label className="block text-xs text-[var(--text-secondary)]">
            Additional context
            <textarea
              value={values.additionalContext}
              onChange={(event) => updateField("additionalContext", event.target.value)}
              rows={3}
              placeholder="Goals, constraints, products, or current campaign context"
              className="mt-1 w-full rounded-xl bg-[#2a313d] px-2 py-2 text-sm text-[var(--text-primary)] outline-none"
            />
          </label>

          <div className="flex items-center justify-end gap-2 pt-1">
            {canDismiss && onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-[#2c3442] px-3 py-2 text-xs font-semibold text-[var(--text-secondary)] hover:bg-[#364053]"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              disabled={loading || !values.userName.trim()}
              className="rounded-full bg-[var(--text-primary)] px-3 py-2 text-xs font-semibold text-[#101215] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-slate-500 disabled:text-slate-200"
            >
              {loading ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
