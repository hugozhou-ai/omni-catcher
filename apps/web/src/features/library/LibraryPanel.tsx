import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Intent, Item } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { ItemCard } from "../../components/ItemCard.js";
import { Icon } from "../../components/Icons.js";
import { MarkdownViewer } from "../../components/MarkdownViewer.js";
import { CollectionPanel } from "./CollectionPanel.js";
import { TodoPanel } from "../todo/TodoPanel.js";
import { showToast } from "../../platform/toast.js";

type LibraryType = "all" | Exclude<Intent, "mixed">;

const FILTERS: Array<{ type: LibraryType; key: "libraryAll" | "tabTodo" | "tabNote" | "tabBookmark" }> = [
  { type: "all", key: "libraryAll" },
  { type: "todo", key: "tabTodo" },
  { type: "note", key: "tabNote" },
  { type: "bookmark", key: "tabBookmark" },
];

export function LibraryPanel(): ReactNode {
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const items = useStore(library.items);
  const [type, setType] = useState<LibraryType>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ item: Item; markdown: string } | null>(null);
  const [pendingNoteId, setPendingNoteId] = useState<string | null>(null);

  useEffect(() => {
    if (type === "all") void library.refresh();
  }, [library, type]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = items.filter((item) => item.type !== "mixed");
    if (!needle) return list;
    return list.filter((item) =>
      [item.title, item.summary || "", item.type, (item.tags || []).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, query]);

  async function openItem(item: Item): Promise<void> {
    if (item.type === "note") {
      setType("note");
      setPendingNoteId(item.id);
      setSelected(null);
      return;
    }
    try {
      const result = await library.readItem(item.id);
      setSelected(result);
    } catch (error) {
      showToast((error as Error).message);
    }
  }

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

  return (
    <section className="library-panel">
      <header className="library-header">
        <div>
          <p className="section-kicker">{t("libraryKicker")}</p>
          <h2>{t("libraryTitle")}</h2>
        </div>
        <div className="library-tabs" role="tablist" aria-label={t("libraryTitle")}>
          {FILTERS.map((filter) => (
            <button
              key={filter.type}
              type="button"
              role="tab"
              aria-selected={type === filter.type}
              className={type === filter.type ? "active" : ""}
              onClick={() => {
                setType(filter.type);
                setSelected(null);
                setPendingNoteId(null);
              }}
            >
              {t(filter.key)}
            </button>
          ))}
        </div>
      </header>

      {type === "all" ? (
        <div className="library-section">
          <label className="search-box collection-search">
            <Icon name="search" />
            <input
              type="search"
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {filtered.length === 0 ? (
            <div className="empty">{query.trim() ? t("emptySearch") : t("emptyLibrary")}</div>
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
                  x
                </button>
              </div>
              <div className="viewer-body">
                <MarkdownViewer markdown={selected.markdown} />
              </div>
            </div>
          ) : null}
        </div>
      ) : type === "todo" ? (
        <TodoPanel embedded />
      ) : (
        <CollectionPanel
          type={type}
          embedded
          initialSelectedId={type === "note" ? pendingNoteId : null}
          onInitialSelectedConsumed={() => setPendingNoteId(null)}
        />
      )}
    </section>
  );
}
