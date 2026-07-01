import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type {
  Capture,
  Classification,
  ConfirmResult,
  Intent,
  PriorityLevel,
  SaveMode,
  SavePlan,
} from "@omni-catcher/shared";
import { useService } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ICaptureService } from "../../services/captureService.js";
import { ILibraryService } from "../../services/libraryService.js";
import { Badge } from "../../components/Badge.js";
import { Select } from "../../components/Select.js";
import { intentKey } from "../../i18n/intent.js";
import { showToast } from "../../platform/toast.js";

const BASE_INTENTS: Intent[] = ["note", "bookmark", "todo"];
const MIXED_INTENTS: Intent[] = [...BASE_INTENTS, "mixed"];
const SAVE_MODES: SaveMode[] = ["new", "merge", "collection"];

export function DecisionCard(props: {
  capture: Capture;
  onDone: () => void;
}): ReactNode {
  const { capture, onDone } = props;
  const { t } = useTranslation();
  const captureService = useService(ICaptureService);
  const library = useService(ILibraryService);

  const data = capture.classification || capture.rulePreview;
  const initialPlan = resolveInitialSavePlan(data);
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
  const [saveMode, setSaveMode] = useState<SaveMode>(initialPlan?.mode || "new");
  const [targetItemId, setTargetItemId] = useState(initialPlan?.targetItemId || "");
  const [insertHeading, setInsertHeading] = useState(initialPlan?.insertHeading || "");
  const [bodyPreview, setBodyPreview] = useState(initialPlan?.bodyPreview || "");

  const showSavePlan = intent === "note";
  const mergeTargetId =
    showSavePlan && (saveMode === "merge" || (saveMode === "collection" && targetItemId)) ? targetItemId : undefined;
  const titleValue = title.trim();
  const canSave = Boolean(titleValue) && !busy;
  const isRuleBased = data.source === "rule" || data.source === "rule-fallback";
  const splitCount = intent === "mixed" ? data.items.length : 0;
  const targetOptions = useMemo(
    () => buildTargetOptions(data, saveMode, t("savePlanNoTarget")),
    [data, saveMode, t],
  );
  const headingOptions = useMemo(
    () => buildHeadingOptions(data, targetItemId, insertHeading),
    [data, targetItemId, insertHeading],
  );

  async function confirm(): Promise<void> {
    if (!titleValue) {
      showToast(t("titleRequired"));
      return;
    }
    setBusy(true);
    try {
      const result = await captureService.confirm(capture.id, {
        intent,
        writeIssue: intent === "todo" && data.todoUpgrade?.agentCompletable ? writeIssue : false,
        edits: {
          title: titleValue,
          tags: tags
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          ...(intent === "todo" ? { urgency, importance } : {}),
          ...(showSavePlan ?
            {
              saveMode,
              targetItemId:
                saveMode === "merge" || saveMode === "collection" ? targetItemId || undefined : undefined,
              insertHeading: insertHeading.trim() || undefined,
              bodyPreview: bodyPreview.trim() || undefined,
            }
          : {}),
        },
      });
      showToast(issueFailed(result) ? t("savedIssueFailed") : t("saved"));
      await library.refresh();
      onDone();
    } catch (error) {
      showToast((error as Error).message);
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    console.info(
      `capture-reject-ui ${JSON.stringify({
        event: "click",
        id: capture.id,
        status: capture.status,
      })}`,
    );
    setBusy(true);
    try {
      await captureService.reject(capture.id);
      showToast(t("discarded"));
      onDone();
    } catch (error) {
      showToast((error as Error).message);
      setBusy(false);
    }
  }

  async function retry(): Promise<void> {
    if (busy || capture.status !== "needs_review") return;
    setBusy(true);
    try {
      await captureService.retry(capture.id);
    } catch (error) {
      showToast((error as Error).message);
      setBusy(false);
    }
  }

  function openDetailByKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    setDetail(true);
  }

  const savePlanPanel = showSavePlan ? (
    <SavePlanEditor
      data={data}
      saveMode={saveMode}
      targetItemId={targetItemId}
      insertHeading={insertHeading}
      bodyPreview={bodyPreview}
      targetOptions={targetOptions}
      headingOptions={headingOptions}
      onSaveMode={setSaveMode}
      onTargetItemId={setTargetItemId}
      onInsertHeading={setInsertHeading}
      onBodyPreview={setBodyPreview}
    />
  ) : null;

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
        {savePlanPanel}
        <div className="decision-detail-grid">
          {data.summary ? (
            <section className="detail-section">
              <h3>{t("agentSummary")}</h3>
              <p>{data.summary}</p>
            </section>
          ) : null}
          {data.alternatives.length || data.relatedItems?.length || data.extractedUrls.length ? (
            <section className="detail-section">
              <h3>{t("decisionReasons")}</h3>
              <div className="decision-reasons">
                {initialPlan?.reason ? (
                  <p>
                    <strong>{t("savePlanReason")}:</strong> {initialPlan.reason}
                  </p>
                ) : null}
                {data.alternatives.map((alternative) => (
                  <p key={`${alternative.intent}-${alternative.reason}`}>
                    <Badge intent={alternative.intent} label={t(intentKey(alternative.intent))} />
                    <span>{alternative.reason}</span>
                  </p>
                ))}
                {data.relatedItems?.length ? (
                  <div>
                    <h4>{t("relatedItems")}</h4>
                    <ul>
                      {data.relatedItems.map((item) => (
                        <li key={item.id}>
                          <strong>{item.title}</strong>
                          <span> - {item.reason}</span>
                          {item.isCollection ? <span> ({t("savePlanModeCollection")})</span> : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {data.extractedUrls.length ? (
                  <div>
                    <h4>{t("sourceUrls")}</h4>
                    <ul>
                      {data.extractedUrls.map((url) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noreferrer">
                            {url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
          <section className="detail-section">
            <h3>{t("originalContent")}</h3>
            <pre>{capture.content}</pre>
          </section>
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
                    {item.tags?.length ? <p className="detail-tags">{item.tags.join(", ")}</p> : null}
                    {item.savePlan ? (
                      <p className="detail-tags">
                        {t("savePlanMode")}: {item.savePlan.mode} — {item.savePlan.reason}
                      </p>
                    ) : null}
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
          saveMode={saveMode}
          mergeTargetId={mergeTargetId}
          busy={busy}
          canSave={canSave}
          onUrgency={setUrgency}
          onImportance={setImportance}
          onWriteIssue={setWriteIssue}
          onReject={reject}
          onRetry={retry}
          onConfirm={confirm}
          canRetry={capture.status === "needs_review"}
        />
      </div>
    );
  }

  return (
    <div className={`decision-card intent-border intent-${intent}`}>
      <div
        className="decision-preview"
        role="button"
        tabIndex={0}
        onClick={() => setDetail(true)}
        onKeyDown={openDetailByKeyboard}
      >
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
          <div className="notice warn">
            {t("needsReview")}
            {capture.error ? (
              <span>
                {" "}
                {t("classificationError")} {capture.error}
              </span>
            ) : null}
          </div>
        )}

        {isRuleBased ? <div className="notice info">{t("ruleBasedDecision")}</div> : null}
        {mergeTargetId ? <div className="notice info">{t("mergeIntoHint")}</div> : null}
        {showSavePlan && saveMode === "collection" && !mergeTargetId ? (
          <div className="notice info">{t("createCollectionHint")}</div>
        ) : null}
        {splitCount ? <div className="notice info">{t("mixedSaveHint")}</div> : null}
        {initialPlan?.reason ? (
          <div className="notice info">
            {t("savePlanReason")}: {initialPlan.reason}
          </div>
        ) : null}

        <h3 className="decision-preview-title">{title || data.title || t("titleRequired")}</h3>
        {data.summary ? <p className="decision-summary">{data.summary}</p> : null}
        {bodyPreview ? <pre className="decision-body-preview">{bodyPreview.slice(0, 320)}</pre> : null}
        <p className="decision-original-preview">{capture.content}</p>
      </div>

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
        {savePlanPanel}
      </div>

      <DecisionFooter
        intent={intent}
        data={data}
        urgency={urgency}
        importance={importance}
        writeIssue={writeIssue}
        saveMode={saveMode}
        mergeTargetId={mergeTargetId}
        busy={busy}
        canSave={canSave}
        onUrgency={setUrgency}
        onImportance={setImportance}
        onWriteIssue={setWriteIssue}
        onReject={reject}
        onRetry={retry}
        onConfirm={confirm}
        canRetry={capture.status === "needs_review"}
      />
    </div>
  );
}

function SavePlanEditor(props: {
  data: Classification;
  saveMode: SaveMode;
  targetItemId: string;
  insertHeading: string;
  bodyPreview: string;
  targetOptions: Array<{ value: string; label: string }>;
  headingOptions: Array<{ value: string; label: string }>;
  onSaveMode: (mode: SaveMode) => void;
  onTargetItemId: (id: string) => void;
  onInsertHeading: (heading: string) => void;
  onBodyPreview: (preview: string) => void;
}): ReactNode {
  const {
    data,
    saveMode,
    targetItemId,
    insertHeading,
    bodyPreview,
    targetOptions,
    headingOptions,
    onSaveMode,
    onTargetItemId,
    onInsertHeading,
    onBodyPreview,
  } = props;
  const { t } = useTranslation();

  return (
    <section className="save-plan-editor">
      <h3>{t("savePlanTitle")}</h3>
      <Select
        className="save-plan-mode"
        label={t("savePlanMode")}
        value={saveMode}
        options={SAVE_MODES.map((mode) => ({
          value: mode,
          label:
            mode === "merge" ? t("savePlanModeMerge")
            : mode === "collection" ? t("savePlanModeCollection")
            : t("savePlanModeNew"),
        }))}
        onChange={onSaveMode}
      />
      {saveMode === "merge" || saveMode === "collection" ? (
        <Select
          className="save-plan-target"
          label={t("savePlanTarget")}
          value={targetItemId}
          options={targetOptions}
          onChange={onTargetItemId}
        />
      ) : null}
      {saveMode !== "new" && headingOptions.length ? (
        <Select
          className="save-plan-heading"
          label={t("savePlanInsertHeading")}
          value={insertHeading}
          options={headingOptions}
          onChange={onInsertHeading}
        />
      ) : saveMode !== "new" ? (
        <div className="field">
          <label>{t("savePlanInsertHeading")}</label>
          <input type="text" value={insertHeading} onChange={(event) => onInsertHeading(event.target.value)} />
        </div>
      ) : null}
      <div className="field">
        <label>{t("savePlanBodyPreview")}</label>
        <textarea rows={6} value={bodyPreview} onChange={(event) => onBodyPreview(event.target.value)} />
      </div>
      {data.savePlan?.reason ? <p className="save-plan-reason">{t("savePlanReason")}: {data.savePlan.reason}</p> : null}
    </section>
  );
}

function resolveInitialSavePlan(data: Classification): SavePlan | null {
  if (data.savePlan) return data.savePlan;
  const preview = data.mergePreview;
  if (!preview) return null;
  if (preview.targetItemId) {
    return {
      mode: "merge",
      targetItemId: preview.targetItemId,
      targetTitle: preview.targetTitle,
      reason: "Legacy merge preview",
      bodyPreview: preview.insertedContent,
    };
  }
  if (preview.targetTitle && preview.insertedContent) {
    return {
      mode: "collection",
      targetTitle: preview.targetTitle,
      reason: "Legacy collection preview",
      bodyPreview: preview.insertedContent,
    };
  }
  return null;
}

function buildTargetOptions(
  data: Classification,
  mode: SaveMode,
  noTargetLabel: string,
): Array<{ value: string; label: string }> {
  const options = [{ value: "", label: noTargetLabel }];
  for (const item of data.relatedItems || []) {
    if (item.type !== "note") continue;
    if (mode === "collection" && !item.isCollection) continue;
    const suffix = item.isCollection ? ` · ${mode === "collection" ? "collection" : item.reason}` : ` (${item.reason})`;
    options.push({ value: item.id, label: `${item.title}${suffix}` });
  }
  return options;
}

function buildHeadingOptions(
  data: Classification,
  targetItemId: string,
  current: string,
): Array<{ value: string; label: string }> {
  const target = (data.relatedItems || []).find((item) => item.id === targetItemId);
  const headings = target?.insertHeadings || [];
  const options = [{ value: "", label: "—" }];
  for (const heading of headings) {
    options.push({ value: heading, label: heading });
  }
  if (current && !headings.includes(current)) {
    options.push({ value: current, label: current });
  }
  return options;
}

function issueFailed(result: ConfirmResult): boolean {
  return Boolean(result.issue && !result.issue.created && result.issue.error);
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
      <div className="decision-title-row">
        <label className="field decision-title-field">
          <span>{t("title")}</span>
          <input
            type="text"
            value={title}
            aria-invalid={!title.trim()}
            onChange={(event) => onTitle(event.target.value)}
          />
        </label>
        <Select
          className="decision-intent-field"
          label={t("changeIntent")}
          value={intent}
          options={selectable.map((option) => ({ value: option, label: t(intentKey(option)) }))}
          onChange={onIntent}
        />
      </div>
      {data.primaryIntent !== intent ? (
        <div className="notice info">
          {t("agentSuggested")} {t(intentKey(data.primaryIntent === "clarify" ? "note" : data.primaryIntent))}
        </div>
      ) : null}
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
  saveMode: SaveMode;
  mergeTargetId?: string;
  busy: boolean;
  canSave: boolean;
  canRetry: boolean;
  onUrgency: (urgency: PriorityLevel) => void;
  onImportance: (importance: PriorityLevel) => void;
  onWriteIssue: (writeIssue: boolean) => void;
  onReject: () => Promise<void>;
  onRetry: () => Promise<void>;
  onConfirm: () => Promise<void>;
}): ReactNode {
  const {
    intent,
    data,
    urgency,
    importance,
    writeIssue,
    saveMode,
    mergeTargetId,
    busy,
    canSave,
    canRetry,
    onUrgency,
    onImportance,
    onWriteIssue,
    onReject,
    onRetry,
    onConfirm,
  } = props;
  const { t } = useTranslation();
  const showIssue = intent === "todo" && data.todoUpgrade?.agentCompletable;
  const priorityOptions = useMemo(
    () =>
      ([1, 2, 3] as const).map((value) => ({
        value,
        label: t(priorityLabelKey(value)),
      })),
    [t],
  );
  const confirmLabel =
    mergeTargetId ? t("confirmMerge")
    : saveMode === "collection" ? t("confirmCollection")
    : t("confirm");

  return (
    <>
      {intent === "todo" ? (
        <div className="priority-row">
          <Select
            className="priority-field"
            label={t("urgency")}
            value={urgency}
            options={priorityOptions}
            onChange={onUrgency}
          />
          <Select
            className="priority-field"
            label={t("importance")}
            value={importance}
            options={priorityOptions}
            onChange={onImportance}
          />
        </div>
      ) : null}

      {showIssue ? (
        <div className="issue-upgrade">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={writeIssue}
              onChange={(event) => onWriteIssue(event.target.checked)}
            />
            {t("writeIssue")}
          </label>
          {data.todoUpgrade.suggestedIssueTitle ? (
            <p>
              {t("issueTitle")}: {data.todoUpgrade.suggestedIssueTitle}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="decision-actions">
        <button type="button" className="danger" disabled={busy} onClick={() => void onReject()}>
          {t("reject")}
        </button>
        {canRetry ? (
          <button type="button" disabled={busy} onClick={() => void onRetry()}>
            {busy ? t("retryingClassification") : t("retryClassification")}
          </button>
        ) : null}
        {!canSave ? <span className="action-hint">{t("titleRequired")}</span> : null}
        <button type="button" className="primary" disabled={!canSave} onClick={() => void onConfirm()}>
          {busy ? t("saving") : confirmLabel}
        </button>
      </div>
    </>
  );
}

function priorityLabelKey(level: PriorityLevel): "priorityLow" | "priorityMedium" | "priorityHigh" {
  if (level >= 3) return "priorityHigh";
  if (level <= 1) return "priorityLow";
  return "priorityMedium";
}
