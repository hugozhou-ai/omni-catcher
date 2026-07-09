import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Item, PriorityLevel, TodoProgress } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { Icon } from "../../components/Icons.js";
import { Select } from "../../components/Select.js";
import { ConfirmDialog } from "../../components/primitives/Dialog.js";
import { showToast } from "../../platform/toast.js";
import { formatItemCount, formatRelativeTime } from "../../util/format.js";

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

export function TodoPanel(props: {
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string | null) => void;
  onGoCapture?: () => void;
}): ReactNode {
  const { selectedItemId = null, onSelectItem, onGoCapture } = props;
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
  const [loadingSelected, setLoadingSelected] = useState(false);
  const [listBootstrapping, setListBootstrapping] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dragOver, setDragOver] = useState<Quadrant | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState(false);
  const reloadToken = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setListBootstrapping(true);
    void library.refresh("todo").finally(() => {
      if (!cancelled) setListBootstrapping(false);
    });
    return () => {
      cancelled = true;
    };
  }, [library]);

  useEffect(() => {
    setLoadError(false);
    if (!selectedItemId) {
      setSelected(null);
      setLoadingSelected(false);
      return;
    }
    let cancelled = false;
    const token = ++reloadToken.current;
    setLoadingSelected(true);
    void library
      .readItem(selectedItemId)
      .then((result) => {
        if (cancelled || token !== reloadToken.current) return;
        setSelected(result);
        setLoadError(false);
      })
      .catch((error) => {
        if (cancelled || token !== reloadToken.current) return;
        showToast((error as Error).message, "error");
        setSelected(null);
        setLoadError(true);
      })
      .finally(() => {
        if (cancelled || token !== reloadToken.current) return;
        setLoadingSelected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [library, selectedItemId]);

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

  const totalCount = items.filter((item) => item.type === "todo").length;
  const hasActiveFilters = Boolean(
    query.trim() || filterUrgency || filterImportance || filterProgress,
  );

  async function openItem(item: Item): Promise<void> {
    onSelectItem?.(item.id);
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await library.deleteItem(pendingDelete.id);
      if (selected?.item.id === pendingDelete.id || selectedItemId === pendingDelete.id) {
        onSelectItem?.(null);
        setSelected(null);
      }
      showToast(t("deleted"));
      setPendingDelete(null);
    } catch (error) {
      showToast((error as Error).message, "error");
    } finally {
      setDeleting(false);
    }
  }

  async function updateProgress(item: Item, todoProgress: TodoProgress): Promise<void> {
    try {
      const next = await library.updateItemMeta(item.id, { todoProgress });
      if (selected?.item.id === item.id) setSelected({ ...selected, item: next });
    } catch (error) {
      showToast((error as Error).message, "error");
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
      showToast((error as Error).message, "error");
    }
  }

  async function dropOnQuadrant(quadrant: Quadrant, itemId: string): Promise<void> {
    const { urgency, importance } = QUADRANT_PRIORITIES[quadrant];
    try {
      await library.updateItemMeta(itemId, { urgency, importance });
    } catch (error) {
      showToast((error as Error).message, "error");
    }
  }

  function retryLoad(): void {
    if (!selectedItemId) return;
    setLoadError(false);
    setLoadingSelected(true);
    const token = ++reloadToken.current;
    void library
      .readItem(selectedItemId)
      .then((result) => {
        if (token !== reloadToken.current) return;
        setSelected(result);
      })
      .catch((error) => {
        if (token !== reloadToken.current) return;
        showToast((error as Error).message, "error");
        setLoadError(true);
      })
      .finally(() => {
        if (token !== reloadToken.current) return;
        setLoadingSelected(false);
      });
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

  const deleteDialog = (
    <ConfirmDialog
      open={Boolean(pendingDelete)}
      onOpenChange={(open) => {
        if (!open) setPendingDelete(null);
      }}
      title={t("deleteItem")}
      description={t("deleteConfirm")}
      confirmLabel={t("deleteItem")}
      cancelLabel={t("cancel")}
      danger
      busy={deleting}
      onConfirm={confirmDelete}
    />
  );

  if (selectedItemId) {
    return (
      <section className="library-content" data-intent="todo">
        {loadingSelected && !selected ? (
          <div className="library-detail-loading" aria-busy="true" aria-label={t("loadingItem")} />
        ) : selected ? (
          <>
            <header className="library-detail-header">
              <div className="library-detail-header-main">
                <div className="library-detail-header-row">
                  <button
                    type="button"
                    className="library-detail-back"
                    onClick={() => onSelectItem?.(null)}
                  >
                    <Icon name="chevronLeft" />
                    {t("back")}
                  </button>
                  <div>
                    <h2>{selected.item.title || selected.item.id}</h2>
                  </div>
                </div>
              </div>
              <div className="library-detail-header-actions">
                <time dateTime={selected.item.createdAt || undefined}>
                  {formatRelativeTime(selected.item.createdAt, t)}
                </time>
                <button type="button" className="viewer-delete" onClick={() => setPendingDelete(selected.item)}>
                  {t("deleteItem")}
                </button>
              </div>
            </header>
            <div className="todo-detail-body scroll-thin">
              <div className="todo-detail-controls">
                <Select
                  label={t("todoProgress")}
                  value={selected.item.todoProgress || "todo"}
                  options={progressOptions}
                  onChange={(progress) => void updateProgress(selected.item, progress)}
                />
              </div>
              <TodoTaskList
                markdown={selected.markdown}
                onToggle={(index, checked) => void toggleTask(index, checked)}
              />
            </div>
          </>
        ) : loadError ? (
          <div className="library-detail-error">
            <p>{t("loadItemFailed")}</p>
            <button type="button" className="primary" onClick={retryLoad}>
              {t("retryLoad")}
            </button>
          </div>
        ) : null}
        {deleteDialog}
      </section>
    );
  }

  return (
    <section className="library-content list-mode" data-intent="todo">
      <header className="library-header">
        <div>
          <p className="section-kicker">{t("libraryKicker")}</p>
          <h2>{t("tabTodo")}</h2>
          <p className="library-count">{formatItemCount(totalCount, t("libraryItemCount"))}</p>
        </div>
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
          <Select inline value={filterUrgency} options={priorityFilterOptions} onChange={setFilterUrgency} />
          <Select
            inline
            value={filterImportance}
            options={importanceFilterOptions}
            onChange={setFilterImportance}
          />
          <Select inline value={filterProgress} options={progressFilterOptions} onChange={setFilterProgress} />
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

      {listBootstrapping ? (
        <div className="skeleton-grid" aria-busy="true" aria-label={t("loadingItem")}>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="skeleton-card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <span className="empty-icon">
            <Icon name="check" />
          </span>
          <span>{hasActiveFilters ? t("emptySearch") : t("emptyLibrary")}</span>
          {!hasActiveFilters && onGoCapture ? (
            <button type="button" className="primary empty-cta" onClick={onGoCapture}>
              {t("goCapture")}
            </button>
          ) : null}
        </div>
      ) : view === "list" ? (
        <div className="card-grid">
          {filtered.map((item) => (
            <TodoCard
              key={item.id}
              variant="list"
              item={item}
              expanded
              onProgress={(progress) => void updateProgress(item, progress)}
              onClick={() => void openItem(item)}
              onDelete={() => setPendingDelete(item)}
            />
          ))}
        </div>
      ) : (
        <div className="eisenhower">
          {MATRIX_ORDER.map((q) => (
            <div
              key={q}
              className={`matrix-cell matrix-${q} ${dragOver === q ? "drag-over" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOver(q);
              }}
              onDragLeave={() => setDragOver((current) => (current === q ? null : current))}
              onDrop={(event) => {
                event.preventDefault();
                setDragOver(null);
                const id = event.dataTransfer.getData("text/plain");
                if (id) void dropOnQuadrant(q, id);
              }}
            >
              <h3>{t(QUADRANT_LABELS[q])}</h3>
              <div className="matrix-items">
                {byQuadrant[q].map((item) => (
                  <TodoCard
                    key={item.id}
                    variant="matrix"
                    item={item}
                    draggable
                    expanded={Boolean(expanded[item.id])}
                    onToggleExpanded={() =>
                      setExpanded((current) => ({ ...current, [item.id]: !current[item.id] }))
                    }
                    onOpen={() => void openItem(item)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {deleteDialog}
    </section>
  );
}

function TodoCard(props: {
  item: Item;
  expanded: boolean;
  variant?: "list" | "matrix";
  draggable?: boolean;
  onClick?: () => void;
  onOpen?: () => void;
  onDelete?: () => void;
  onToggleExpanded?: () => void;
  onProgress?: (progress: TodoProgress) => void;
}): ReactNode {
  const {
    item,
    expanded,
    variant = "list",
    draggable,
    onClick,
    onOpen,
    onDelete,
    onToggleExpanded,
    onProgress,
  } = props;
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

  if (variant === "matrix") {
    return (
      <article
        className={`item-card todo-card matrix-todo-card intent-todo ${expanded ? "expanded" : "compact"}`}
        draggable={draggable}
        onClick={onToggleExpanded}
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", item.id);
          event.dataTransfer.effectAllowed = "move";
        }}
      >
        <div className="matrix-card-main">
          <Icon name="chevronRight" className="icon matrix-card-chevron" />
          <h3 className="item-card-title">{item.title || item.id}</h3>
          <span className={`progress-chip progress-${progress}`}>{t(progressKey(progress))}</span>
        </div>
        {expanded && onOpen ? (
          <button
            type="button"
            className="matrix-card-details-link"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            {t("details")}
          </button>
        ) : null}
      </article>
    );
  }

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
        <div className="item-card-title-block">
          <h3 className="item-card-title">{item.title || item.id}</h3>
          <time className="item-card-date" dateTime={item.createdAt || undefined}>
            {formatRelativeTime(item.createdAt, t)}
          </time>
        </div>
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
            onChange={(next) => onProgress?.(next)}
            compact
            stopPropagation
          />
          {item.tags?.length ? (
            <div className="item-card-tag-chips">
              {item.tags.map((tag) => (
                <span key={tag} className="item-card-tag-chip">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </>
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
