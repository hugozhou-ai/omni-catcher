import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Item } from "@omni-catcher/shared";
import { useTranslation } from "../hooks/useTranslation.js";
import { useService, useStore } from "../platform/react.js";
import { ILibraryService } from "../services/libraryService.js";
import { IWorkspaceService } from "../services/workspaceService.js";
import { ILocalizationService } from "../services/localizationService.js";
import { IThemeService } from "../services/themeService.js";
import { Icon, type IconName } from "./Icons.js";
import { Select } from "./Select.js";
import { Tooltip } from "./primitives/Tooltip.js";
import { showToast } from "../platform/toast.js";
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
  drawerOpen: boolean;
  librarySelection: LibrarySelection;
  onNavigate: (view: AppView) => void;
  onExpandedChange: (expanded: boolean) => void;
  onDrawerOpenChange: (open: boolean) => void;
  onLibraryNavigate: (category: LibraryCategory, itemId?: string | null) => void;
}): ReactNode {
  const {
    active,
    expanded,
    drawerOpen,
    librarySelection,
    onNavigate,
    onExpandedChange,
    onDrawerOpenChange,
    onLibraryNavigate,
  } = props;
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const workspace = useService(IWorkspaceService);
  const localization = useService(ILocalizationService);
  const themeService = useService(IThemeService);
  const items = useStore(library.items);
  const locale = useStore(localization.locale);
  const theme = useStore(themeService.theme);
  const [expandedCategories, setExpandedCategories] = useState<Record<LibraryCategory, boolean>>({
    todo: false,
    note: false,
    bookmark: false,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [preferred, setPreferred] = useState("");
  const settingsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active !== "library") return;
    void library.refresh();
  }, [active, library]);

  useEffect(() => {
    void Promise.all([workspace.getProviders(), workspace.getPreferredProvider()]).then(
      ([result, saved]) => {
        const names = result.providers.map((provider) => provider.provider);
        setProviders(names);
        setPreferred(names.includes(saved) ? saved : "");
      },
    );
  }, [workspace]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    function handlePointer(event: PointerEvent): void {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setSettingsOpen(false);
    }
    document.addEventListener("pointerdown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [settingsOpen]);

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

  function navigateCategory(category: LibraryCategory): void {
    onLibraryNavigate(category, null);
    onDrawerOpenChange(false);
  }

  function toggleCategoryOpen(category: LibraryCategory): void {
    setExpandedCategories((current) => ({ ...current, [category]: !current[category] }));
  }

  function handleCategoryToggle(category: LibraryCategory): void {
    navigateCategory(category);
    toggleCategoryOpen(category);
  }

  function handleCategoryClick(category: LibraryCategory): void {
    if (category === "note") {
      handleCategoryToggle(category);
      return;
    }
    navigateCategory(category);
  }

  function closeDrawerAfterNavigate(view: AppView): void {
    onNavigate(view);
    onDrawerOpenChange(false);
  }

  return (
    <>
      {drawerOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label={t("closeMenu")}
          onClick={() => onDrawerOpenChange(false)}
        />
      ) : null}
      <nav
        className={`sidebar ${expanded || drawerOpen ? "expanded" : "collapsed"}`}
        aria-label="Main"
      >
        <div className="sidebar-brand">
          <button
            type="button"
            className="sidebar-mobile-toggle"
            aria-label={drawerOpen ? t("closeMenu") : t("openMenu")}
            onClick={() => onDrawerOpenChange(!drawerOpen)}
          >
            <Icon name="menu" />
          </button>
          <button
            type="button"
            className="sidebar-brand-toggle"
            aria-label={expanded ? t("collapseSidebar") : t("expandSidebar")}
            aria-expanded={expanded}
            title={expanded ? t("collapseSidebar") : t("expandSidebar")}
            onClick={() => {
              if (window.matchMedia("(max-width: 820px)").matches) {
                onDrawerOpenChange(!drawerOpen);
                return;
              }
              onExpandedChange(!expanded);
            }}
          >
            {expanded || drawerOpen ? (
              <img
                src="/omni-catcher-logo-large.webp"
                alt="Omni Catcher"
                className="sidebar-logo-wide"
                draggable={false}
              />
            ) : (
              <img
                src="/omni-catcher-icon.webp"
                alt="Omni Catcher"
                className="sidebar-logo-mark"
                draggable={false}
              />
            )}
          </button>
        </div>

        <Tooltip content={t("navHome")} side="right">
          <button
            type="button"
            className={`sidebar-btn sidebar-primary ${active === "capture" ? "active" : ""}`}
            title={t("navHome")}
            aria-label={t("navHome")}
            aria-current={active === "capture" ? "page" : undefined}
            onClick={() => closeDrawerAfterNavigate("capture")}
          >
            <Icon name="capture" />
            <span>{t("navHome")}</span>
          </button>
        </Tooltip>

        <Tooltip content={t("navLibrary")} side="right">
          <button
            type="button"
            className={`sidebar-btn ${active === "library" ? "active" : ""}`}
            title={t("navLibrary")}
            aria-label={t("navLibrary")}
            aria-current={active === "library" ? "page" : undefined}
            onClick={() => {
              onLibraryNavigate(librarySelection.category, librarySelection.itemId);
              if (window.matchMedia("(max-width: 820px)").matches) onDrawerOpenChange(true);
            }}
          >
            <Icon name="grid" />
            <span>{t("navLibrary")}</span>
          </button>
        </Tooltip>

        {(active === "library" && expanded) || drawerOpen ? (
          <div className="sidebar-library scroll-thin" aria-label={t("navLibrary")}>
            {LIBRARY_CATEGORIES.map((category) => {
              const categoryActive = librarySelection.category === category;
              const categoryOpen = expandedCategories[category];
              const categoryItems = itemsByCategory[category];
              return (
                <div key={category} className="sidebar-library-group" data-intent={category}>
                  <div className="sidebar-category-row">
                    <button
                      type="button"
                      className={`sidebar-category intent-${category} ${categoryActive ? "active" : ""}`}
                      aria-expanded={category === "note" ? categoryOpen : undefined}
                      onClick={() => handleCategoryClick(category)}
                    >
                      <Icon name={CATEGORY_ICONS[category]} />
                      <span className="sidebar-category-label">{t(CATEGORY_LABELS[category])}</span>
                    </button>
                    <button
                      type="button"
                      className="sidebar-category-toggle"
                      aria-label={`${categoryOpen ? t("collapse") : t("expand")} ${t(CATEGORY_LABELS[category])}`}
                      aria-expanded={categoryOpen}
                      onClick={() =>
                        category === "note" ? handleCategoryToggle(category) : toggleCategoryOpen(category)
                      }
                    >
                      <Icon
                        name="chevronRight"
                        className={`icon sidebar-category-chevron ${categoryOpen ? "open" : ""}`}
                      />
                    </button>
                  </div>
                  {categoryOpen ? (
                    <div className="sidebar-library-items">
                      {categoryItems.length === 0 ? (
                        <div className="sidebar-library-empty">{t("emptyLibrary")}</div>
                      ) : (
                        categoryItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`sidebar-item intent-${category} ${
                              librarySelection.category === category && librarySelection.itemId === item.id
                                ? "active"
                                : ""
                            }`}
                            title={item.title || item.id}
                            onClick={() => {
                              onLibraryNavigate(category, item.id);
                              onDrawerOpenChange(false);
                            }}
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

        <div className="sidebar-footer">
          <div className="sidebar-settings" ref={settingsRef}>
            <Tooltip content={t("settingsTitle")} side="right">
              <button
                type="button"
                className="sidebar-btn"
                aria-label={t("settingsTitle")}
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((current) => !current)}
              >
                <Icon name="settings" />
                <span>{t("settingsTitle")}</span>
              </button>
            </Tooltip>
            {settingsOpen ? (
              <div className="sidebar-settings-panel">
                <strong>{t("settingsTitle")}</strong>
                {providers.length ? (
                  <Select
                    label={t("providerLabel")}
                    value={preferred}
                    options={[
                      { value: "", label: t("providerDefaultOption") },
                      ...providers.map((name) => ({ value: name, label: name })),
                    ]}
                    onChange={(value) => {
                      setPreferred(value);
                      void workspace.setPreferredProvider(value).catch((error) =>
                        showToast((error as Error).message, "error"),
                      );
                    }}
                  />
                ) : (
                  <p className="provider-hint-warn">{t("providerNone")}</p>
                )}
                <div className="sidebar-settings-meta">
                  <span>
                    {t("settingsLocale")}: {locale}
                  </span>
                  <span>
                    {t("settingsTheme")}: {theme}
                  </span>
                  <span>{t("settingsHostManaged")}</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </nav>
    </>
  );
}
