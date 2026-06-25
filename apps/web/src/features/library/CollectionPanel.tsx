import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Intent, Item } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { ItemCard } from "../../components/ItemCard.js";
import { Icon } from "../../components/Icons.js";
import { MarkdownViewer } from "../../components/MarkdownViewer.js";
import { showToast } from "../../platform/toast.js";

export function CollectionPanel(props: {
  type: Intent;
  embedded?: boolean;
  initialSelectedId?: string | null;
  onInitialSelectedConsumed?: () => void;
}): ReactNode {
  const { type, embedded = false, initialSelectedId = null, onInitialSelectedConsumed } = props;
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const items = useStore(library.items);

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ item: Item; markdown: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const titleKey = type === "note" ? "tabNote" : "tabBookmark";
  const useDetailLayout = type === "note";
  const inDetailView = useDetailLayout && selectedId !== null;

  useEffect(() => {
    void library.refresh(type);
  }, [library, type]);

  useEffect(() => {
    if (!initialSelectedId || type !== "note") return;
    let cancelled = false;
    setSelectedId(initialSelectedId);
    setLoading(true);
    void library
      .readItem(initialSelectedId)
      .then((result) => {
        if (cancelled) return;
        setSelected(result);
      })
      .catch((error) => {
        if (cancelled) return;
        showToast((error as Error).message);
        setSelectedId(null);
        setSelected(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        onInitialSelectedConsumed?.();
      });
    return () => {
      cancelled = true;
    };
  }, [initialSelectedId, type, library, onInitialSelectedConsumed]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = items.filter((item) => item.type === type);
    if (tagFilter) list = list.filter((item) => (item.tags || []).includes(tagFilter));
    if (!needle) return list;
    return list.filter((item) =>
      [item.title, item.summary || "", (item.tags || []).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, type, query, tagFilter]);

  const tags = useMemo(() => {
    if (type !== "bookmark") return [];
    const values = new Set<string>();
    for (const item of items) {
      if (item.type !== "bookmark") continue;
      for (const tag of item.tags || []) {
        const trimmed = tag.trim();
        if (trimmed) values.add(trimmed);
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [items, type]);

  async function openItemById(itemId: string): Promise<void> {
    setSelectedId(itemId);
    setLoading(true);
    try {
      const result = await library.readItem(itemId);
      setSelected(result);
    } catch (error) {
      showToast((error as Error).message);
      setSelectedId(null);
      setSelected(null);
    } finally {
      setLoading(false);
    }
  }

  async function openItem(item: Item): Promise<void> {
    if (useDetailLayout) {
      await openItemById(item.id);
      return;
    }
    const result = await library.readItem(item.id);
    setSelected(result);
  }

  function closeDetail(): void {
    setSelectedId(null);
    setSelected(null);
  }

  async function deleteItem(item: Item): Promise<void> {
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      await library.deleteItem(item.id);
      if (selected?.item.id === item.id || selectedId === item.id) {
        closeDetail();
      }
      showToast(t("deleted"));
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  if (inDetailView) {
    return (
      <section className={`collection-panel detail-mode ${embedded ? "embedded" : ""}`}>
        <div className="library-detail-layout">
          <aside className="library-detail-list" aria-label={t(titleKey)}>
            <div className="library-detail-list-head">
              <button type="button" className="library-detail-back" onClick={closeDetail}>
                <Icon name="chevronLeft" />
                <span>{t("back")}</span>
              </button>
              <label className="search-box library-detail-search">
                <Icon name="search" />
                <input
                  type="search"
                  placeholder={t("searchPlaceholder")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
            </div>
            <div className="item-list">
              {filtered.length === 0 ? (
                <div className="item-list-empty">{query.trim() ? t("emptySearch") : t("emptyLibrary")}</div>
              ) : (
                filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`item-list-row ${selectedId === item.id ? "active" : ""}`}
                    onClick={() => void openItemById(item.id)}
                  >
                    <span className="item-list-title">{item.title || item.id}</span>
                    {item.summary ? <span className="item-list-summary">{item.summary}</span> : null}
                    <time className="item-list-date">{(item.createdAt || "").slice(0, 10)}</time>
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="library-detail-content">
            {loading && !selected ? (
              <div className="library-detail-loading" aria-busy="true" />
            ) : selected ? (
              <>
                <header className="library-detail-header">
                  <div className="library-detail-header-main">
                    <h2>{selected.item.title || selected.item.id}</h2>
                    {selected.item.tags?.length ? (
                      <div className="library-detail-tags">{selected.item.tags.join(" · ")}</div>
                    ) : null}
                  </div>
                  <div className="library-detail-header-actions">
                    <time>{(selected.item.createdAt || "").slice(0, 10)}</time>
                    <button type="button" className="viewer-delete" onClick={() => void deleteItem(selected.item)}>
                      {t("deleteItem")}
                    </button>
                  </div>
                </header>
                <div className="library-detail-body">
                  <MarkdownViewer markdown={selected.markdown} />
                </div>
              </>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={embedded ? "collection-panel embedded" : "collection-panel"}>
      <header className="collection-header">
        {embedded ? null : <h2>{t(titleKey)}</h2>}
        <label className="search-box collection-search">
          <Icon name="search" />
          <input
            type="search"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {type === "bookmark" && tags.length ? (
          <div className="tag-filter" role="list" aria-label={t("tagFilterAll")}>
            <button type="button" className={!tagFilter ? "active" : ""} onClick={() => setTagFilter("")}>
              {t("tagFilterAll")}
            </button>
            {tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className={tagFilter === tag ? "active" : ""}
                onClick={() => setTagFilter(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {filtered.length === 0 ? (
        <div className="empty">{query.trim() || tagFilter ? t("emptySearch") : t("emptyLibrary")}</div>
      ) : (
        <div className="card-grid">
          {filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onClick={() => void openItem(item)}
              onDelete={() => void deleteItem(item)}
            />
          ))}
        </div>
      )}

      {!useDetailLayout && selected ? (
        <div className="viewer">
          <div className="viewer-actions">
            <button type="button" className="viewer-delete" onClick={() => void deleteItem(selected.item)}>
              {t("deleteItem")}
            </button>
            <button type="button" className="viewer-close" onClick={() => setSelected(null)}>
              ×
            </button>
          </div>
          <div className="viewer-body">
            <MarkdownViewer markdown={selected.markdown} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
