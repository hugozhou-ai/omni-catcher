import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Item } from "@omni-catcher/shared";
import { useTranslation } from "../hooks/useTranslation.js";
import { useService, useStore } from "../platform/react.js";
import { ILibraryService } from "../services/libraryService.js";
import { Icon, type IconName } from "./Icons.js";
import {
  LIBRARY_CATEGORIES,
  type LibraryCategory,
  type LibrarySelection,
} from "../features/library/libraryNavigation.js";

export type AppView = "capture" | "library";

const CATEGORY_ICONS: Record<LibraryCategory, IconName> = {
  todo: "check",
  note: "document",
  bookmark: "bookmark",
};

const CATEGORY_LABELS: Record<LibraryCategory, "tabTodo" | "tabNote" | "tabBookmark"> = {
  todo: "tabTodo",
  note: "tabNote",
  bookmark: "tabBookmark",
};

export function Sidebar(props: {
  active: AppView;
  expanded: boolean;
  librarySelection: LibrarySelection;
  onNavigate: (view: AppView) => void;
  onExpandedChange: (expanded: boolean) => void;
  onLibraryNavigate: (category: LibraryCategory, itemId?: string | null) => void;
}): ReactNode {
  const {
    active,
    expanded,
    librarySelection,
    onNavigate,
    onExpandedChange,
    onLibraryNavigate,
  } = props;
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const items = useStore(library.items);
  const [expandedCategories, setExpandedCategories] = useState<Record<LibraryCategory, boolean>>({
    todo: true,
    note: true,
    bookmark: true,
  });

  useEffect(() => {
    if (active !== "library") return;
    void library.refresh();
  }, [active, library]);

  const itemsByCategory = useMemo(() => {
    const grouped: Record<LibraryCategory, Item[]> = { todo: [], note: [], bookmark: [] };
    for (const item of items) {
      if (item.type === "todo" || item.type === "note" || item.type === "bookmark") {
        grouped[item.type].push(item);
      }
    }
    for (const category of LIBRARY_CATEGORIES) {
      grouped[category].sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || ""));
    }
    return grouped;
  }, [items]);

  function toggleCategory(category: LibraryCategory): void {
    setExpandedCategories((current) => ({ ...current, [category]: !current[category] }));
    onLibraryNavigate(category, null);
  }

  return (
    <nav className={`sidebar ${expanded ? "expanded" : "collapsed"}`} aria-label="Main">
      <div className="sidebar-brand">
        <button
          type="button"
          className="sidebar-brand-toggle"
          aria-label={expanded ? t("collapseSidebar") : t("expandSidebar")}
          aria-expanded={expanded}
          title={expanded ? t("collapseSidebar") : t("expandSidebar")}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? (
            <img src="/omni-catcher-logo-large.webp" alt="Omni Catcher" className="sidebar-logo-wide" />
          ) : (
            <img src="/omni-catcher-icon.webp" alt="Omni Catcher" className="sidebar-logo-mark" />
          )}
        </button>
      </div>

      <button
        type="button"
        className={`sidebar-btn sidebar-primary ${active === "capture" ? "active" : ""}`}
        title={t("navHome")}
        aria-label={t("navHome")}
        aria-current={active === "capture" ? "page" : undefined}
        onClick={() => onNavigate("capture")}
      >
        <Icon name="capture" />
        <span>{t("navHome")}</span>
      </button>

      <button
        type="button"
        className={`sidebar-btn ${active === "library" ? "active" : ""}`}
        title={t("navLibrary")}
        aria-label={t("navLibrary")}
        aria-current={active === "library" ? "page" : undefined}
        onClick={() => onLibraryNavigate(librarySelection.category, librarySelection.itemId)}
      >
        <Icon name="grid" />
        <span>{t("navLibrary")}</span>
      </button>

      {active === "library" && expanded ? (
        <div className="sidebar-library" aria-label={t("navLibrary")}>
          {LIBRARY_CATEGORIES.map((category) => {
            const categoryActive =
              librarySelection.category === category && librarySelection.itemId === null;
            const categoryOpen = expandedCategories[category];
            const categoryItems = itemsByCategory[category];
            return (
              <div key={category} className="sidebar-library-group">
                <button
                  type="button"
                  className={`sidebar-category ${categoryActive ? "active" : ""}`}
                  aria-expanded={categoryOpen}
                  onClick={() => toggleCategory(category)}
                >
                  <Icon name={CATEGORY_ICONS[category]} />
                  <span className="sidebar-category-label">{t(CATEGORY_LABELS[category])}</span>
                  <Icon name="chevronRight" className={`sidebar-category-chevron ${categoryOpen ? "open" : ""}`} />
                </button>
                {categoryOpen ? (
                  <div className="sidebar-library-items">
                    {categoryItems.length === 0 ? (
                      <div className="sidebar-library-empty">{t("emptyLibrary")}</div>
                    ) : (
                      categoryItems.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className={`sidebar-item ${
                            librarySelection.category === category && librarySelection.itemId === item.id
                              ? "active"
                              : ""
                          }`}
                          title={item.title || item.id}
                          onClick={() => onLibraryNavigate(category, item.id)}
                        >
                          <span className="sidebar-item-title">{item.title || item.id}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </nav>
  );
}
