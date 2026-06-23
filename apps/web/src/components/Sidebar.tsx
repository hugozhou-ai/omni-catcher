import type { ReactNode } from "react";
import { useTranslation } from "../hooks/useTranslation.js";
import { Icon, type IconName } from "./Icons.js";

export type AppView = "capture" | "library";

export function Sidebar(props: {
  active: AppView;
  onNavigate: (view: AppView) => void;
}): ReactNode {
  const { active, onNavigate } = props;
  const { t } = useTranslation();

  const items: { view: AppView; label: string; icon: IconName; primary?: boolean }[] = [
    { view: "capture", label: t("navHome"), icon: "capture", primary: true },
    { view: "library", label: t("navLibrary"), icon: "grid" },
  ];

  return (
    <nav className="sidebar" aria-label="Main">
      <div className="sidebar-brand" aria-hidden="true">
        <img src="/omni-catcher-icon.png" alt="" />
      </div>
      {items.map(({ view, label, icon, primary }) => (
        <button
          key={view}
          type="button"
          className={`sidebar-btn ${primary ? "sidebar-primary" : ""} ${active === view ? "active" : ""}`}
          title={label}
          aria-label={label}
          aria-current={active === view ? "page" : undefined}
          onClick={() => onNavigate(view)}
        >
          <Icon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}
