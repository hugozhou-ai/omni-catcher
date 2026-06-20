import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Intent, Item } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { ItemCard } from "../../components/ItemCard.js";

export function CollectionPanel(props: { type: Intent }): ReactNode {
  const { type } = props;
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const items = useStore(library.items);

  const [query, setQuery] = useState("");
  const [markdown, setMarkdown] = useState<string | null>(null);

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
    setMarkdown(result.markdown);
  }

  return (
    <section className="collection-panel">
      <header className="collection-header">
        <h2>{t(titleKey)}</h2>
        <input
          type="search"
          className="collection-search"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </header>

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
            ×
          </button>
          <pre>{markdown}</pre>
        </div>
      ) : null}
    </section>
  );
}
