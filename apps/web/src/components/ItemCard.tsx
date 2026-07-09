import type { ReactNode } from "react";
import type { Item } from "@omni-catcher/shared";
import { Icon } from "./Icons.js";
import { useTranslation } from "../hooks/useTranslation.js";
import { formatRelativeTime } from "../util/format.js";

export function ItemCard(props: {
  item: Item;
  onClick?: () => void;
  onDelete?: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
}): ReactNode {
  const { item, onClick, onDelete, draggable, onDragStart } = props;
  const { t } = useTranslation();

  return (
    <article
      className={`item-card intent-${item.type}`}
      onClick={onClick}
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
        onDragStart?.();
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
      {item.summary ? <p className="item-card-summary">{item.summary}</p> : null}
      {item.type === "todo" && (item.urgency || item.importance) ? (
        <div className="item-card-meta">
          {item.urgency ? (
            <span className="priority-chip">
              {t("urgency")}: {t(priorityKey(item.urgency))}
            </span>
          ) : null}
          {item.importance ? (
            <span className="priority-chip">
              {t("importance")}: {t(priorityKey(item.importance))}
            </span>
          ) : null}
        </div>
      ) : null}
      {item.tags?.length ? (
        <div className="item-card-tag-chips">
          {item.tags.map((tag) => (
            <span key={tag} className="item-card-tag-chip">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function priorityKey(level: number): "priorityLow" | "priorityMedium" | "priorityHigh" {
  if (level >= 3) return "priorityHigh";
  if (level <= 1) return "priorityLow";
  return "priorityMedium";
}
