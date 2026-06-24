import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Item, PriorityLevel, TodoProgress } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { Icon } from "../../components/Icons.js";
import { Select } from "../../components/Select.js";
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

const MATRIX_ORDER: Quadrant[] = ["q2", "q1", "q4", "q3"];

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
  const [filterProgress, setFilterProgress] = useState<"" | TodoProgress>("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<{ item: Item; markdown: string } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

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
    if (filterProgress) list = list.filter((item) => (item.todoProgress || "todo") === filterProgress);
    list.sort((a, b) => {
      if (sortBy === "urgency") return (b.urgency ?? 2) - (a.urgency ?? 2);
      if (sortBy === "importance") return (b.importance ?? 2) - (a.importance ?? 2);
      return (b.createdAt || "").localeCompare(a.createdAt || "");
    });
    return list;
  }, [items, query, filterUrgency, filterImportance, filterProgress, sortBy]);

  const byQuadrant = useMemo(() => {
    const map: Record<Quadrant, Item[]> = { q1: [], q2: [], q3: [], q4: [] };
    for (const item of filtered) map[quadrantOf(item)].push(item);
    return map;
  }, [filtered]);

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

  async function updateProgress(item: Item, todoProgress: TodoProgress): Promise<void> {
    try {
      const next = await library.updateItemMeta(item.id, { todoProgress });
      if (selected?.item.id === item.id) setSelected({ ...selected, item: next });
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  async function toggleTask(taskIndex: number, completed: boolean): Promise<void> {
    if (!selected) return;
    const previous = selected;
    const optimisticMarkdown = replaceTodoCheckbox(selected.markdown, taskIndex, completed);
    setSelected({
      ...selected,
      item: { ...selected.item, todoProgress: inferTodoProgress(optimisticMarkdown) },
      markdown: optimisticMarkdown,
    });
    try {
      const next = await library.updateTodoTask(selected.item.id, taskIndex, completed);
      setSelected(next);
    } catch (error) {
      setSelected(previous);
      showToast((error as Error).message);
    }
  }

  async function dropOnQuadrant(quadrant: Quadrant, itemId: string): Promise<void> {
    const { urgency, importance } = QUADRANT_PRIORITIES[quadrant];
    try {
      await library.updateItemMeta(itemId, { urgency, importance });
    } catch (error) {
      showToast((error as Error).message);
    }
  }

  const sortOptions = useMemo(
    () =>
      (
        [
          ["created", "sortCreated"],
          ["urgency", "sortUrgency"],
          ["importance", "sortImportance"],
        ] as const
      ).map(([value, key]) => ({ value, label: t(key) })),
    [t],
  );
  const priorityFilterOptions = useMemo(
    () =>
      ([0, 1, 2, 3] as const).map((value) => ({
        value,
        label: value === 0 ? t("filterUrgencyAll") : t(priorityKey(value)),
      })),
    [t],
  );
  const importanceFilterOptions = useMemo(
    () =>
      ([0, 1, 2, 3] as const).map((value) => ({
        value,
        label: value === 0 ? t("filterImportanceAll") : t(priorityKey(value)),
      })),
    [t],
  );
  const progressFilterOptions = useMemo(
    () =>
      (
        [
          ["", "filterProgressAll"],
          ["todo", "todoProgressTodo"],
          ["doing", "todoProgressDoing"],
          ["done", "todoProgressDone"],
        ] as const
      ).map(([value, key]) => ({ value, label: t(key) })),
    [t],
  );
  const progressOptions = useMemo(
    () =>
      (["todo", "doing", "done"] as const).map((value) => ({
        value,
        label: t(progressKey(value)),
      })),
    [t],
  );

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
          <Select inline value={sortBy} options={sortOptions} onChange={setSortBy} />
          <Select
            inline
            value={filterUrgency}
            options={priorityFilterOptions}
            onChange={setFilterUrgency}
          />
          <Select
            inline
            value={filterImportance}
            options={importanceFilterOptions}
            onChange={setFilterImportance}
          />
          <Select
            inline
            value={filterProgress}
            options={progressFilterOptions}
            onChange={setFilterProgress}
          />
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
            <TodoCard
              key={item.id}
              item={item}
              expanded
              onProgress={(progress) => void updateProgress(item, progress)}
              onClick={() => void openItem(item)}
              onDelete={() => void deleteItem(item)}
            />
          ))}
        </div>
      ) : (
        <div className="eisenhower">
          {MATRIX_ORDER.map((q) => (
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
                  <TodoCard
                    key={item.id}
                    item={item}
                    draggable
                    expanded={Boolean(expanded[item.id])}
                    onToggleExpanded={() =>
                      setExpanded((current) => ({ ...current, [item.id]: !current[item.id] }))
                    }
                    onProgress={(progress) => void updateProgress(item, progress)}
                    onOpen={() => void openItem(item)}
                    onDelete={() => void deleteItem(item)}
                  />
                ))}
              </div>
            </div>
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
          <div className="todo-detail-body">
            <div className="todo-detail-controls">
              <Select
                label={t("todoProgress")}
                value={selected.item.todoProgress || "todo"}
                options={progressOptions}
                onChange={(progress) => void updateProgress(selected.item, progress)}
              />
            </div>
            <TodoTaskList markdown={selected.markdown} onToggle={(index, checked) => void toggleTask(index, checked)} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function TodoCard(props: {
  item: Item;
  expanded: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onOpen?: () => void;
  onDelete?: () => void;
  onToggleExpanded?: () => void;
  onProgress: (progress: TodoProgress) => void;
}): ReactNode {
  const { item, expanded, draggable, onClick, onOpen, onDelete, onToggleExpanded, onProgress } = props;
  const { t } = useTranslation();
  const progress = item.todoProgress || "todo";
  const progressOptions = useMemo(
    () =>
      (["todo", "doing", "done"] as const).map((value) => ({
        value,
        label: t(progressKey(value)),
      })),
    [t],
  );

  return (
    <article
      className={`item-card todo-card intent-${item.type} ${expanded ? "expanded" : "compact"}`}
      draggable={draggable}
      onClick={onClick}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="item-card-head">
        <div className="item-card-type">
          <Icon name="check" />
          <span className={`progress-chip progress-${progress}`}>{t(progressKey(progress))}</span>
        </div>
        <div className="item-card-actions">
          <time className="item-card-date">{(item.createdAt || "").slice(0, 10)}</time>
          {onDelete ? (
            <button
              type="button"
              className="item-card-delete"
              title={t("deleteItem")}
              aria-label={t("deleteItem")}
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              <Icon name="trash" />
            </button>
          ) : null}
        </div>
      </div>
      <h3 className="item-card-title">{item.title || item.id}</h3>
      {expanded ? (
        <>
          {item.summary ? <p className="item-card-summary">{item.summary}</p> : null}
          <div className="item-card-meta">
            <span className="priority-chip">
              {t("urgency")}: {t(priorityKey(item.urgency ?? 2))}
            </span>
            <span className="priority-chip">
              {t("importance")}: {t(priorityKey(item.importance ?? 2))}
            </span>
          </div>
          <Select
            label={t("todoProgress")}
            value={progress}
            options={progressOptions}
            onChange={onProgress}
            compact
            stopPropagation
          />
          {item.tags?.length ? <div className="item-card-tags">{item.tags.join(" · ")}</div> : null}
        </>
      ) : null}
      {onToggleExpanded || onOpen ? (
        <div className="matrix-card-actions">
          {onToggleExpanded ? (
            <button type="button" onClick={onToggleExpanded}>
              {expanded ? t("collapse") : t("expand")}
            </button>
          ) : null}
          {onOpen ? (
            <button type="button" onClick={onOpen}>
              {t("details")}
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

type TodoTask = { index: number; checked: boolean; text: string };

function TodoTaskList(props: {
  markdown: string;
  onToggle: (taskIndex: number, checked: boolean) => void;
}): ReactNode {
  const { markdown, onToggle } = props;
  const { t } = useTranslation();
  const tasks = parseTodoTasks(markdown);

  return (
    <section className="todo-task-panel">
      <h3>{t("todoTasks")}</h3>
      {tasks.length ? (
        <div className="todo-task-list">
          {tasks.map((task) => (
            <label key={task.index} className="todo-task-row">
              <input
                type="checkbox"
                checked={task.checked}
                onChange={(event) => onToggle(task.index, event.target.checked)}
              />
              <span>{task.text}</span>
            </label>
          ))}
        </div>
      ) : (
        <p>{t("todoNoTasks")}</p>
      )}
    </section>
  );
}

function parseTodoTasks(markdown: string): TodoTask[] {
  const tasks: TodoTask[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (!match) continue;
    tasks.push({
      index: tasks.length,
      checked: match[1]?.toLowerCase() === "x",
      text: match[2] || "",
    });
  }
  return tasks;
}

function replaceTodoCheckbox(markdown: string, taskIndex: number, completed: boolean): string {
  let seen = -1;
  return markdown
    .split("\n")
    .map((line) => {
      const match = line.match(/^(\s*[-*]\s+\[)( |x|X)(\]\s+.*)$/);
      if (!match) return line;
      seen += 1;
      if (seen !== taskIndex) return line;
      return `${match[1]}${completed ? "x" : " "}${match[3]}`;
    })
    .join("\n");
}

function inferTodoProgress(markdown: string): TodoProgress {
  const states = parseTodoTasks(markdown).map((task) => task.checked);
  if (!states.length) return "todo";
  const done = states.filter(Boolean).length;
  if (done === states.length) return "done";
  if (done > 0) return "doing";
  return "todo";
}

function progressKey(progress: TodoProgress): "todoProgressTodo" | "todoProgressDoing" | "todoProgressDone" {
  if (progress === "done") return "todoProgressDone";
  if (progress === "doing") return "todoProgressDoing";
  return "todoProgressTodo";
}

function priorityKey(level: PriorityLevel): "priorityLow" | "priorityMedium" | "priorityHigh" {
  if (level >= 3) return "priorityHigh";
  if (level <= 1) return "priorityLow";
  return "priorityMedium";
}
