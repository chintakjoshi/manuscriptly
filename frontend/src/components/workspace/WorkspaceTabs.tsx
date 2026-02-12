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
    <div className="inline-flex rounded-full bg-[#2a313d] p-1">
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
              isActive ? "bg-[var(--text-primary)] text-[#111318]" : "text-[var(--text-secondary)] hover:bg-[#343c4c]"
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
