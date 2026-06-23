import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Intent, Item } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { ItemCard } from "../../components/ItemCard.js";
import { Icon } from "../../components/Icons.js";
import { CollectionPanel } from "./CollectionPanel.js";
import { TodoPanel } from "../todo/TodoPanel.js";

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
  const [markdown, setMarkdown] = useState<string | null>(null);

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
    const result = await library.readItem(item.id);
    setMarkdown(result.markdown);
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
                setMarkdown(null);
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
            <div className="empty">{t("emptyLibrary")}</div>
          ) : (
            <div className="card-grid">
              {filtered.map((item) => (
                <ItemCard key={item.id} item={item} onClick={() => void openItem(item)} />
              ))}
            </div>
          )}

          {markdown !== null ? (
            <div className="viewer">
              <button type="button" className="viewer-close" onClick={() => setMarkdown(null)}>
                x
              </button>
              <pre>{markdown}</pre>
            </div>
          ) : null}
        </div>
      ) : type === "todo" ? (
        <TodoPanel embedded />
      ) : (
        <CollectionPanel type={type} embedded />
      )}
    </section>
  );
}
