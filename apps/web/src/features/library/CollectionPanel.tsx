import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Intent, Item } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { ItemCard } from "../../components/ItemCard.js";
import { Icon } from "../../components/Icons.js";
import { MarkdownViewer } from "../../components/MarkdownViewer.js";
import { showToast } from "../../platform/toast.js";

export function CollectionPanel(props: { type: Intent; embedded?: boolean }): ReactNode {
  const { type, embedded = false } = props;
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const items = useStore(library.items);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ item: Item; markdown: string } | null>(null);

  const titleKey = type === "note" ? "tabNote" : "tabBookmark";

  useEffect(() => {
    void library.refresh(type);
  }, [library, type]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = items.filter((item) => item.type === type);
    if (!needle) return list;
    return list.filter((item) =>
      [item.title, item.summary || "", (item.tags || []).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, type, query]);

  async function openItem(item: Item): Promise<void> {
    const result = await library.readItem(item.id);
    setSelected(result);
  }

  async function deleteItem(item: Item): Promise<void> {
    if (!window.confirm(t("deleteConfirm"))) return;
    await library.deleteItem(item.id);
    if (selected?.item.id === item.id) setSelected(null);
    showToast(t("deleted"));
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
      </header>

      {filtered.length === 0 ? (
        <div className="empty">{t("emptyLibrary")}</div>
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

      {selected ? (
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
