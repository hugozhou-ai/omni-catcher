import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Item } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { Badge } from "../../components/Badge.js";
import { intentKey } from "../../i18n/intent.js";
import type { Messages } from "../../i18n/index.js";

type Tab = "all" | "note" | "bookmark" | "todo";

const TABS: Array<{ key: Tab; label: keyof Messages }> = [
  { key: "all", label: "tabAll" },
  { key: "note", label: "tabNote" },
  { key: "bookmark", label: "tabBookmark" },
  { key: "todo", label: "tabTodo" },
];

export function LibraryPanel(): ReactNode {
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const items = useStore(library.items);
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [markdown, setMarkdown] = useState<string | null>(null);

  useEffect(() => {
    void library.refresh(tab);
  }, [library, tab]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.title, item.type, (item.tags || []).join(" ")].join(" ").toLowerCase().includes(needle),
    );
  }, [items, query]);

  async function open(item: Item): Promise<void> {
    const result = await library.readItem(item.id);
    setMarkdown(result.markdown);
  }

  return (
    <section className="panel">
      <h2>{t("libraryTitle")}</h2>
      <div className="row">
        <div className="tabs">
          {TABS.map((entry) => (
            <button
              key={entry.key}
              className={entry.key === tab ? "active" : ""}
              onClick={() => setTab(entry.key)}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="grow"
          placeholder={t("searchPlaceholder")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="empty">{t("emptyLibrary")}</div>
      ) : (
        <div>
          {filtered.map((item) => (
            <div key={item.id} className="item" onClick={() => void open(item)}>
              <span className="title">
                <Badge intent={item.type} label={t(intentKey(item.type))} />
                <span className="item-title">{item.title || item.id}</span>
              </span>
              <span className="when">{(item.createdAt || "").slice(0, 10)}</span>
            </div>
          ))}
        </div>
      )}

      {markdown !== null && (
        <div className="viewer">
          <pre>{markdown}</pre>
        </div>
      )}
    </section>
  );
}
