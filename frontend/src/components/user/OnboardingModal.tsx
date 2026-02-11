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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Setup your writer profile</h2>
              <p className="mt-1 text-sm text-slate-600">
                This context is saved and injected into the agent prompt automatically.
              </p>
            </div>
            {canDismiss && onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-600">
              Name
              <input
                type="text"
                value={values.userName}
                onChange={(event) => updateField("userName", event.target.value)}
                placeholder="Your name"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
                required
              />
            </label>
            <label className="text-xs text-slate-600">
              Company
              <input
                type="text"
                value={values.companyName}
                onChange={(event) => updateField("companyName", event.target.value)}
                placeholder="Company name"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
              />
            </label>
            <label className="text-xs text-slate-600">
              Industry
              <input
                type="text"
                value={values.industry}
                onChange={(event) => updateField("industry", event.target.value)}
                placeholder="e.g. SaaS, Ecommerce"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
              />
            </label>
            <label className="text-xs text-slate-600">
              Brand voice
              <input
                type="text"
                value={values.brandVoice}
                onChange={(event) => updateField("brandVoice", event.target.value)}
                placeholder="e.g. Practical and confident"
                className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
              />
            </label>
          </div>

          <label className="block text-xs text-slate-600">
            Target audience
            <textarea
              value={values.targetAudience}
              onChange={(event) => updateField("targetAudience", event.target.value)}
              rows={2}
              placeholder="Who are you writing for?"
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
            />
          </label>

          <label className="block text-xs text-slate-600">
            Additional context
            <textarea
              value={values.additionalContext}
              onChange={(event) => updateField("additionalContext", event.target.value)}
              rows={3}
              placeholder="Goals, constraints, products, or current campaign context"
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
            />
          </label>

          <div className="flex items-center justify-end gap-2 pt-1">
            {canDismiss && onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            ) : null}
            <button
              type="submit"
              disabled={loading || !values.userName.trim()}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            >
              {loading ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
