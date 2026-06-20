import type { ReactNode } from "react";
import type { Item } from "@omni-catcher/shared";
import { Badge } from "./Badge.js";
import { intentKey } from "../i18n/intent.js";
import { useTranslation } from "../hooks/useTranslation.js";

export function ItemCard(props: {
  item: Item;
  onClick?: () => void;
  draggable?: boolean;
  onDragStart?: () => void;
}): ReactNode {
  const { item, onClick, draggable, onDragStart } = props;
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
        <Badge intent={item.type} label={t(intentKey(item.type))} />
        <time className="item-card-date">{(item.createdAt || "").slice(0, 10)}</time>
      </div>
      <h3 className="item-card-title">{item.title || item.id}</h3>
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
        <div className="item-card-tags">{item.tags.join(" · ")}</div>
      ) : null}
    </article>
  );
}

function priorityKey(level: number): "priorityLow" | "priorityMedium" | "priorityHigh" {
  if (level >= 3) return "priorityHigh";
  if (level <= 1) return "priorityLow";
  return "priorityMedium";
}
