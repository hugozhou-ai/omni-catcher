import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Intent, Item } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ILibraryService } from "../../services/libraryService.js";
import { ItemCard } from "../../components/ItemCard.js";
import { Icon } from "../../components/Icons.js";
import { MarkdownViewer } from "../../components/MarkdownViewer.js";
import { MarkdownEditor } from "../../components/MarkdownEditor.js";
import { ConfirmDialog } from "../../components/primitives/Dialog.js";
import { showToast } from "../../platform/toast.js";
import { stripFrontmatter } from "../../util/markdown.js";
import { formatItemCount, formatRelativeTime } from "../../util/format.js";

export function CollectionPanel(props: {
  type: Exclude<Intent, "mixed" | "todo">;
  selectedItemId?: string | null;
  onSelectItem?: (itemId: string | null) => void;
  onGoCapture?: () => void;
}): ReactNode {
  const { type, selectedItemId = null, onSelectItem, onGoCapture } = props;
  const { t } = useTranslation();
  const library = useService(ILibraryService);
  const items = useStore(library.items);

  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [selected, setSelected] = useState<{ item: Item; markdown: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [listBootstrapping, setListBootstrapping] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Item | null>(null);
  const [deleting, setDeleting] = useState(false);
  const reloadToken = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setListBootstrapping(true);
    void library.refresh(type).finally(() => {
      if (!cancelled) setListBootstrapping(false);
    });
    return () => {
      cancelled = true;
    };
  }, [library, type]);

  useEffect(() => {
    setEditing(false);
    setDraftBody("");
    setLoadError(false);
    if (!selectedItemId) {
      setSelected(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const token = ++reloadToken.current;
    setLoading(true);
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
    const values = new Set<string>();
    for (const item of items) {
      if (item.type !== type) continue;
      for (const tag of item.tags || []) {
        const trimmed = tag.trim();
        if (trimmed) values.add(trimmed);
      }
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [items, type]);

  const categoryLabel = type === "note" ? t("tabNote") : t("tabBookmark");
  const totalCount = items.filter((item) => item.type === type).length;

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await library.deleteItem(pendingDelete.id);
      if (selected?.item.id === pendingDelete.id || selectedItemId === pendingDelete.id) {
        setSelected(null);
        onSelectItem?.(null);
      }
      showToast(t("deleted"));
      setPendingDelete(null);
    } catch (error) {
      showToast((error as Error).message, "error");
    } finally {
      setDeleting(false);
    }
  }

  function startEditing(): void {
    if (!selected) return;
    setDraftBody(stripFrontmatter(selected.markdown));
    setEditing(true);
  }

  function cancelEditing(): void {
    setEditing(false);
    setDraftBody("");
  }

  async function saveEditing(): Promise<void> {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const result = await library.updateItemContent(selected.item.id, { body: draftBody });
      setSelected(result);
      setEditing(false);
      setDraftBody("");
      showToast(t("saved"));
    } catch (error) {
      showToast((error as Error).message, "error");
    } finally {
      setSaving(false);
    }
  }

  function retryLoad(): void {
    if (!selectedItemId) return;
    setLoadError(false);
    setLoading(true);
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
        setLoading(false);
      });
  }

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
      <section className="library-content" data-intent={type}>
        {loading && !selected ? (
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
                    {selected.item.tags?.length ? (
                      <div className="item-card-tag-chips library-detail-tags">
                        {selected.item.tags.map((tag) => (
                          <span key={tag} className="item-card-tag-chip">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="library-detail-header-actions">
                <time dateTime={selected.item.createdAt || undefined}>
                  {formatRelativeTime(selected.item.createdAt, t)}
                </time>
                {editing ? (
                  <>
                    <button type="button" className="viewer-action" disabled={saving} onClick={cancelEditing}>
                      {t("cancelEdit")}
                    </button>
                    <button
                      type="button"
                      className="viewer-action primary"
                      disabled={saving}
                      onClick={() => void saveEditing()}
                    >
                      {saving ? t("saving") : t("saveEdit")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="viewer-action" onClick={startEditing}>
                    {t("editItem")}
                  </button>
                )}
                <button
                  type="button"
                  className="viewer-delete"
                  disabled={editing || saving}
                  onClick={() => setPendingDelete(selected.item)}
                >
                  {t("deleteItem")}
                </button>
              </div>
            </header>
            <div className={`library-detail-body scroll-thin ${editing ? "library-detail-body-editing" : ""}`}>
              {editing ? (
                <MarkdownEditor value={draftBody} onChange={setDraftBody} disabled={saving} />
              ) : (
                <MarkdownViewer markdown={selected.markdown} />
              )}
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
    <section className="library-content list-mode" data-intent={type}>
      <header className="library-header">
        <div>
          <p className="section-kicker">{t("libraryKicker")}</p>
          <h2>{categoryLabel}</h2>
          <p className="library-count">{formatItemCount(totalCount, t("libraryItemCount"))}</p>
        </div>
        <div className="collection-toolbar">
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
            <Icon name={type === "note" ? "document" : "bookmark"} />
          </span>
          <span>{query.trim() || tagFilter ? t("emptySearch") : t("emptyLibrary")}</span>
          {!query.trim() && !tagFilter && onGoCapture ? (
            <button type="button" className="primary empty-cta" onClick={onGoCapture}>
              {t("goCapture")}
            </button>
          ) : null}
        </div>
      ) : (
        <div className="card-grid">
          {filtered.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              onClick={() => onSelectItem?.(item.id)}
              onDelete={() => setPendingDelete(item)}
            />
          ))}
        </div>
      )}
      {deleteDialog}
    </section>
  );
}
