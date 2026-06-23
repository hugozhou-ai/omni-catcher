import { useState, type ReactNode } from "react";
import type { Capture, Classification, Intent, PriorityLevel } from "@omni-catcher/shared";
import { useService } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ICaptureService } from "../../services/captureService.js";
import { ILibraryService } from "../../services/libraryService.js";
import { Badge } from "../../components/Badge.js";
import { intentKey } from "../../i18n/intent.js";
import { showToast } from "../../platform/toast.js";

const BASE_INTENTS: Intent[] = ["note", "bookmark", "todo"];
const MIXED_INTENTS: Intent[] = [...BASE_INTENTS, "mixed"];

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
  const selectable = data.items.length ? MIXED_INTENTS : BASE_INTENTS;

  const [title, setTitle] = useState(data.title || "");
  const [tags, setTags] = useState((data.tags || []).join(", "));
  const [intent, setIntent] = useState<Intent>(
    selectable.includes(primary as Intent) ? (primary as Intent) : "note",
  );
  const [urgency, setUrgency] = useState<PriorityLevel>(2);
  const [importance, setImportance] = useState<PriorityLevel>(2);
  const [writeIssue, setWriteIssue] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(false);

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

  if (detail) {
    return (
      <div className={`decision-card decision-detail intent-border intent-${intent}`}>
        <div className="decision-detail-head">
          <button type="button" onClick={() => setDetail(false)}>
            {t("back")}
          </button>
          <Badge intent={intent} label={t(intentKey(intent))} />
        </div>
        <DecisionEditor
          data={data}
          intent={intent}
          title={title}
          tags={tags}
          selectable={selectable}
          onIntent={setIntent}
          onTitle={setTitle}
          onTags={setTags}
        />
        <div className="decision-detail-grid">
          {data.summary ? (
            <section className="detail-section">
              <h3>{t("agentSummary")}</h3>
              <p>{data.summary}</p>
            </section>
          ) : null}
          <section className="detail-section">
            <h3>{t("originalContent")}</h3>
            <pre>{capture.content}</pre>
          </section>
          {data.mergePreview ? (
            <section className="detail-section merge-preview">
              <h3>{data.mergePreview.targetTitle || t("existingArticle")}</h3>
              {data.mergePreview.existingContent ? (
                <pre className="existing-content">{data.mergePreview.existingContent}</pre>
              ) : null}
              {data.mergePreview.insertedContent ? (
                <pre className="inserted-content">{data.mergePreview.insertedContent}</pre>
              ) : null}
            </section>
          ) : null}
          {data.items.length ? (
            <section className="detail-section">
              <h3>{t("mixedItems")}</h3>
              <div className="mixed-items">
                {data.items.map((item, index) => (
                  <article key={`${item.type}-${index}`} className={`mixed-item intent-${item.type}`}>
                    <Badge intent={item.type} label={t(intentKey(item.type))} />
                    {item.title ? <h4>{item.title}</h4> : null}
                    {item.summary ? <p>{item.summary}</p> : null}
                    {item.url ? <p className="detail-url">{item.url}</p> : null}
                    {item.tasks?.length ? (
                      <ul>
                        {item.tasks.map((task) => (
                          <li key={task}>{task}</li>
                        ))}
                      </ul>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>
        <DecisionFooter
          intent={intent}
          data={data}
          urgency={urgency}
          importance={importance}
          writeIssue={writeIssue}
          busy={busy}
          onUrgency={setUrgency}
          onImportance={setImportance}
          onWriteIssue={setWriteIssue}
          onReject={reject}
          onConfirm={confirm}
        />
      </div>
    );
  }

  return (
    <div className={`decision-card intent-border intent-${intent}`}>
      <button type="button" className="decision-preview" onClick={() => setDetail(true)}>
        <div className="decision-head">
          <div>
            <Badge intent={intent} label={t(intentKey(intent))} />
            {data.confidence > 0 && (
              <span className="confidence">
                {t("confidence")} {Math.round(data.confidence * 100)}%
              </span>
            )}
          </div>
          <span className="detail-link">{t("viewDetail")}</span>
        </div>

        {capture.status === "needs_review" && (
          <div className="notice warn">{t("needsReview")}</div>
        )}

        <h3 className="decision-preview-title">{title || data.title}</h3>
        {data.summary ? <p className="decision-summary">{data.summary}</p> : null}
        <p className="decision-original-preview">{capture.content}</p>
      </button>

      <div className="decision-form compact">
        <DecisionEditor
          data={data}
          intent={intent}
          title={title}
          tags={tags}
          selectable={selectable}
          onIntent={setIntent}
          onTitle={setTitle}
          onTags={setTags}
        />
      </div>

      <DecisionFooter
        intent={intent}
        data={data}
        urgency={urgency}
        importance={importance}
        writeIssue={writeIssue}
        busy={busy}
        onUrgency={setUrgency}
        onImportance={setImportance}
        onWriteIssue={setWriteIssue}
        onReject={reject}
        onConfirm={confirm}
      />
    </div>
  );
}

function DecisionEditor(props: {
  data: Classification;
  intent: Intent;
  title: string;
  tags: string;
  selectable: Intent[];
  onIntent: (intent: Intent) => void;
  onTitle: (title: string) => void;
  onTags: (tags: string) => void;
}): ReactNode {
  const { data, intent, title, tags, selectable, onIntent, onTitle, onTags } = props;
  const { t } = useTranslation();

  return (
    <>
      <div className="field">
        <label>{t("changeIntent")}</label>
        <select value={intent} onChange={(event) => onIntent(event.target.value as Intent)}>
          {selectable.map((option) => (
            <option key={option} value={option}>
              {t(intentKey(option))}
            </option>
          ))}
        </select>
      </div>
      {data.primaryIntent !== intent ? (
        <div className="notice info">
          {t("agentSuggested")} {t(intentKey(data.primaryIntent === "clarify" ? "note" : data.primaryIntent))}
        </div>
      ) : null}
      <div className="field">
        <label>{t("title")}</label>
        <input type="text" value={title} onChange={(event) => onTitle(event.target.value)} />
      </div>
      <div className="field">
        <label>{t("tags")}</label>
        <input type="text" value={tags} onChange={(event) => onTags(event.target.value)} />
      </div>
    </>
  );
}

function DecisionFooter(props: {
  intent: Intent;
  data: Classification;
  urgency: PriorityLevel;
  importance: PriorityLevel;
  writeIssue: boolean;
  busy: boolean;
  onUrgency: (urgency: PriorityLevel) => void;
  onImportance: (importance: PriorityLevel) => void;
  onWriteIssue: (writeIssue: boolean) => void;
  onReject: () => Promise<void>;
  onConfirm: () => Promise<void>;
}): ReactNode {
  const {
    intent,
    data,
    urgency,
    importance,
    writeIssue,
    busy,
    onUrgency,
    onImportance,
    onWriteIssue,
    onReject,
    onConfirm,
  } = props;
  const { t } = useTranslation();
  const showIssue = intent === "todo" && data.todoUpgrade?.agentCompletable;

  return (
    <>
      {intent === "todo" ? (
        <div className="priority-row">
          <label className="priority-field">
            <span>{t("urgency")}</span>
            <select
              value={urgency}
              onChange={(event) => onUrgency(Number(event.target.value) as PriorityLevel)}
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
              onChange={(event) => onImportance(Number(event.target.value) as PriorityLevel)}
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
            onChange={(event) => onWriteIssue(event.target.checked)}
          />
          {t("writeIssue")}
        </label>
      ) : null}

      <div className="decision-actions">
        <button type="button" className="danger" onClick={() => void onReject()}>
          {t("reject")}
        </button>
        <button type="button" className="primary" disabled={busy} onClick={() => void onConfirm()}>
          {t("confirm")}
        </button>
      </div>
    </>
  );
}
