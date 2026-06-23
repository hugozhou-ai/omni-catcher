import { useState, type ReactNode } from "react";
import { useTranslation } from "../hooks/useTranslation.js";
import { Icon, type IconName } from "./Icons.js";

export type AppView = "capture" | "library";

export function Sidebar(props: {
  active: AppView;
  onNavigate: (view: AppView) => void;
}): ReactNode {
  const { active, onNavigate } = props;
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const items: { view: AppView; label: string; icon: IconName; primary?: boolean }[] = [
    { view: "capture", label: t("navHome"), icon: "capture", primary: true },
    { view: "library", label: t("navLibrary"), icon: "grid" },
  ];

  return (
    <nav className={`sidebar ${expanded ? "expanded" : "collapsed"}`} aria-label="Main">
      <div className="sidebar-brand">
        <button
          type="button"
          className="sidebar-brand-toggle"
          aria-label={expanded ? t("collapseSidebar") : t("expandSidebar")}
          aria-expanded={expanded}
          title={expanded ? t("collapseSidebar") : t("expandSidebar")}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? (
            <img src="/omni-catcher-logo-large.webp" alt="Omni Catcher" className="sidebar-logo-wide" />
          ) : (
            <img src="/omni-catcher-icon.webp" alt="Omni Catcher" className="sidebar-logo-mark" />
          )}
          <Icon name="chevronRight" className="sidebar-toggle-icon" />
        </button>
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
