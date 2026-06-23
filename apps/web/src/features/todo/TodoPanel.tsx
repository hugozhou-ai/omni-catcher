import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Item, PriorityLevel } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { ItemCard } from "../../components/ItemCard.js";
import { Icon } from "../../components/Icons.js";
import { showToast } from "../../platform/toast.js";

type SortKey = "created" | "urgency" | "importance";
type ViewMode = "list" | "matrix";

type Quadrant = "q1" | "q2" | "q3" | "q4";

const QUADRANT_LABELS: Record<Quadrant, "matrixQ1" | "matrixQ2" | "matrixQ3" | "matrixQ4"> = {
  q1: "matrixQ1",
  q2: "matrixQ2",
  q3: "matrixQ3",
  q4: "matrixQ4",
};

const QUADRANT_PRIORITIES: Record<Quadrant, { urgency: PriorityLevel; importance: PriorityLevel }> = {
  q1: { urgency: 3, importance: 3 },
  q2: { urgency: 1, importance: 3 },
  q3: { urgency: 3, importance: 1 },
  q4: { urgency: 1, importance: 1 },
};

function isHigh(level: PriorityLevel | undefined): boolean {
  return (level ?? 2) >= 2;
}

function quadrantOf(item: Item): Quadrant {
  const urgent = isHigh(item.urgency);
  const important = isHigh(item.importance);
  if (important && urgent) return "q1";
  if (important && !urgent) return "q2";
  if (!important && urgent) return "q3";
  return "q4";
}

export function TodoPanel(props: { embedded?: boolean } = {}): ReactNode {
  const { embedded = false } = props;
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const items = useStore(library.items);

  const [view, setView] = useState<ViewMode>("list");
  const [sortBy, setSortBy] = useState<SortKey>("created");
  const [filterUrgency, setFilterUrgency] = useState<0 | PriorityLevel>(0);
  const [filterImportance, setFilterImportance] = useState<0 | PriorityLevel>(0);
  const [query, setQuery] = useState("");
  const [markdown, setMarkdown] = useState<string | null>(null);

  useEffect(() => {
    void library.refresh("todo");
  }, [library]);

  const filtered = useMemo(() => {
    let list = items.filter((item) => item.type === "todo");
    const needle = query.trim().toLowerCase();
    if (needle) {
      list = list.filter((item) =>
        [item.title, item.summary || "", (item.tags || []).join(" ")]
          .join(" ")
          .toLowerCase()
          .includes(needle),
      );
    }
    if (filterUrgency) list = list.filter((item) => (item.urgency ?? 2) === filterUrgency);
    if (filterImportance) {
      list = list.filter((item) => (item.importance ?? 2) === filterImportance);
    }
    list.sort((a, b) => {
      if (sortBy === "urgency") return (b.urgency ?? 2) - (a.urgency ?? 2);
      if (sortBy === "importance") return (b.importance ?? 2) - (a.importance ?? 2);
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
    return list;
  }, [items, query, filterUrgency, filterImportance, sortBy]);

  const byQuadrant = useMemo(() => {
    const map: Record<Quadrant, Item[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const item of filtered) map[quadrantOf(item)].push(item);
    return map;
  }, [filtered]);

  async function openItem(item: Item): Promise<void> {
    const result = await library.readItem(item.id);
    setMarkdown(result.markdown);
  }

  async function dropOnQuadrant(quadrant: Quadrant, itemId: string): Promise<void> {
    const { urgency, importance } = QUADRANT_PRIORITIES[quadrant];
    try {
      await library.updateItemMeta(itemId, { urgency, importance });
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  return (
    <section className={embedded ? "collection-panel embedded" : "collection-panel"}>
      <header className="collection-header">
        {embedded ? null : <h2>{t("tabTodo")}</h2>}
        <div className="collection-toolbar">
          <label className="search-box grow">
            <Icon name="search" />
            <input
              type="search"
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)}>
            <option value="created">{t("sortCreated")}</option>
            <option value="urgency">{t("sortUrgency")}</option>
            <option value="importance">{t("sortImportance")}</option>
          </select>
          <select
            value={filterUrgency}
            onChange={(event) => setFilterUrgency(Number(event.target.value) as 0 | PriorityLevel)}
          >
            <option value={0}>{t("filterUrgencyAll")}</option>
            <option value={1}>{t("priorityLow")}</option>
            <option value={2}>{t("priorityMedium")}</option>
            <option value={3}>{t("priorityHigh")}</option>
          </select>
          <select
            value={filterImportance}
            onChange={(event) =>
              setFilterImportance(Number(event.target.value) as 0 | PriorityLevel)
            }
          >
            <option value={0}>{t("filterImportanceAll")}</option>
            <option value={1}>{t("priorityLow")}</option>
            <option value={2}>{t("priorityMedium")}</option>
            <option value={3}>{t("priorityHigh")}</option>
          </select>
          <div className="view-toggle">
            <button
              type="button"
              className={view === "list" ? "active" : ""}
              onClick={() => setView("list")}
              title={t("viewList")}
            >
              <Icon name="list" />
            </button>
            <button
              type="button"
              className={view === "matrix" ? "active" : ""}
              onClick={() => setView("matrix")}
              title={t("viewMatrix")}
            >
              <Icon name="grid" />
            </button>
          </div>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="empty">{t("emptyLibrary")}</div>
      ) : view === "list" ? (
        <div className="card-grid">
          {filtered.map((item) => (
            <ItemCard key={item.id} item={item} onClick={() => void openItem(item)} />
          ))}
        </div>
      ) : (
        <div className="eisenhower">
          {(["q1", "q2", "q3", "q4"] as Quadrant[]).map((q) => (
            <div
              key={q}
              className={`matrix-cell matrix-${q}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData("text/plain");
                if (id) void dropOnQuadrant(q, id);
              }}
            >
              <h3>{t(QUADRANT_LABELS[q])}</h3>
              <div className="matrix-items">
                {byQuadrant[q].map((item) => (
                  <ItemCard key={item.id} item={item} draggable onClick={() => void openItem(item)} />
                ))}
              </div>
            </div>
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
