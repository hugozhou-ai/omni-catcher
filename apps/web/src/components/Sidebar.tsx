import type { ReactNode } from "react";
import { useTranslation } from "../hooks/useTranslation.js";

export type AppView = "home" | "todo" | "note" | "bookmark";

const SIDEBAR_ICON = "/omni-catcher-icon.png";

export function Sidebar(props: {
  active: AppView;
  onNavigate: (view: AppView) => void;
}): ReactNode {
  const { active, onNavigate } = props;
  const { t } = useTranslation();

  const items: { view: AppView; label: string }[] = [
    { view: "home", label: t("navHome") },
    { view: "todo", label: t("navTodo") },
    { view: "note", label: t("navNote") },
    { view: "bookmark", label: t("navBookmark") },
  ];

  return (
    <nav className="sidebar" aria-label="Main">
      {items.map(({ view, label }) => (
        <button
          key={view}
          type="button"
          className={`sidebar-btn ${active === view ? "active" : ""}`}
          title={label}
          aria-label={label}
          aria-current={active === view ? "page" : undefined}
          onClick={() => onNavigate(view)}
        >
          <img src={SIDEBAR_ICON} alt="" className="sidebar-icon" />
        </button>
      ))}
    </nav>
  );
}
