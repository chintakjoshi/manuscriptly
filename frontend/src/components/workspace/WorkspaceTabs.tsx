type WorkspaceTab = "plan" | "content";

type WorkspaceTabsProps = {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
};

export function WorkspaceTabs({ activeTab, onChange }: WorkspaceTabsProps) {
  const tabs: Array<{ key: WorkspaceTab; label: string }> = [
    { key: "plan", label: "Plan" },
    { key: "content", label: "Content" },
  ];

  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1">
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
              isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export type { WorkspaceTab };
