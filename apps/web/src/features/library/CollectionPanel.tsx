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
  type: Exclude<Intent, "mixed" | "todo">;
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string) => void;
}): ReactNode {
  const { type, selectedItemId = null, onSelectItem } = props;
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const items = useStore(library.items);

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [selected, setSelected] = useState<{ item: Item; markdown: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void library.refresh(type);
  }, [library, type]);

  useEffect(() => {
    if (!selectedItemId) {
      setSelected(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void library
      .readItem(selectedItemId)
      .then((result) => {
        if (cancelled) return;
        setSelected(result);
      })
      .catch((error) => {
        if (cancelled) return;
        showToast((error as Error).message);
        setSelected(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedItemId, library]);

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

  async function deleteItem(item: Item): Promise<void> {
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      await library.deleteItem(item.id);
      if (selected?.item.id === item.id) setSelected(null);
      showToast(t("deleted"));
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  if (selectedItemId) {
    return (
      <section className="library-content">
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
      </section>
    );
  }

  if (type === "note") {
    return (
      <section className="library-content">
        <div className="library-empty-state">{t("librarySelectItem")}</div>
      </section>
    );
  }

  return (
    <section className="library-content">
      <header className="collection-header">
        <label className="search-box collection-search">
          <Icon name="search" />
          <input
            type="search"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {tags.length ? (
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
              onClick={() => onSelectItem?.(item.id)}
              onDelete={() => void deleteItem(item)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
