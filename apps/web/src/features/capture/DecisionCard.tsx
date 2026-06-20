import { useState, type ReactNode } from "react";
import type { Capture, Intent, PriorityLevel } from "@omni-catcher/shared";
import { useService } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ICaptureService } from "../../services/captureService.js";
import { ILibraryService } from "../../services/libraryService.js";
import { Badge } from "../../components/Badge.js";
import { intentKey } from "../../i18n/intent.js";
import { showToast } from "../../platform/toast.js";

const SELECTABLE: Intent[] = ["note", "bookmark", "todo"];

export function DecisionCard(props: {
  capture: Capture;
  onDone: () => void;
}): ReactNode {
  const { capture, onDone } = props;
  const { t } = useTranslation();
  const captureService = useService(ICaptureService);
  const library = useService(ILibraryService);

  const data = capture.classification || capture.rulePreview;
  const primary = data.primaryIntent === "mixed" ? "mixed" : data.primaryIntent;

  const [title, setTitle] = useState(data.title || "");
  const [tags, setTags] = useState((data.tags || []).join(", "));
  const [intent, setIntent] = useState<Intent>(
    SELECTABLE.includes(primary as Intent) ? (primary as Intent) : "note",
  );
  const [urgency, setUrgency] = useState<PriorityLevel>(2);
  const [importance, setImportance] = useState<PriorityLevel>(2);
  const [writeIssue, setWriteIssue] = useState(false);
  const [busy, setBusy] = useState(false);

  const showIssue = intent === "todo" && data.todoUpgrade?.agentCompletable;

  async function confirm(): Promise<void> {
    setBusy(true);
    try {
      await captureService.confirm(capture.id, {
        intent,
        writeIssue: showIssue ? writeIssue : false,
        edits: {
          title: title.trim(),
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...(intent === "todo" ? { urgency, importance } : {}),
        },
      });
      showToast(t("saved"));
      await library.refresh();
      onDone();
    } catch (error) {
      showToast((error as Error).message);
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    await captureService.reject(capture.id);
    showToast(t("discarded"));
    onDone();
  }

  return (
    <div className={`decision-card intent-border intent-${intent}`}>
      <div className="decision-head">
        <Badge intent={intent} label={t(intentKey(intent))} />
        {data.confidence > 0 && (
          <span className="hint">
            {t("confidence")} {Math.round(data.confidence * 100)}%
          </span>
        )}
      </div>

      {capture.status === "needs_review" && (
        <div className="notice warn">{t("needsReview")}</div>
      )}

      <div className="field">
        <label>{t("title")}</label>
        <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>

      {data.summary ? <p className="decision-summary">{data.summary}</p> : null}

      <div className="field">
        <label>{t("tags")}</label>
        <input type="text" value={tags} onChange={(event) => setTags(event.target.value)} />
      </div>

      <div className="intent-pills">
        {SELECTABLE.map((option) => (
          <button
            key={option}
            type="button"
            className={option === intent ? "active" : ""}
            onClick={() => setIntent(option)}
          >
            {t(intentKey(option))}
          </button>
        ))}
      </div>

      {intent === "todo" ? (
        <div className="priority-row">
          <label className="priority-field">
            <span>{t("urgency")}</span>
            <select
              value={urgency}
              onChange={(event) => setUrgency(Number(event.target.value) as PriorityLevel)}
            >
              <option value={1}>{t("priorityLow")}</option>
              <option value={2}>{t("priorityMedium")}</option>
              <option value={3}>{t("priorityHigh")}</option>
            </select>
          </label>
          <label className="priority-field">
            <span>{t("importance")}</span>
            <select
              value={importance}
              onChange={(event) => setImportance(Number(event.target.value) as PriorityLevel)}
            >
              <option value={1}>{t("priorityLow")}</option>
              <option value={2}>{t("priorityMedium")}</option>
              <option value={3}>{t("priorityHigh")}</option>
            </select>
          </label>
        </div>
      ) : null}

      {showIssue ? (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={writeIssue}
            onChange={(event) => setWriteIssue(event.target.checked)}
          />
          {t("writeIssue")}
        </label>
      ) : null}

      <div className="decision-actions">
        <button type="button" className="danger" onClick={() => void reject()}>
          {t("reject")}
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void confirm()}>
          {t("confirm")}
        </button>
      </div>
    </div>
  );
}
