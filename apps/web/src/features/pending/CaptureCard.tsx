import { useState, type ReactNode } from "react";
import type { Capture, Intent } from "@omni-catcher/shared";
import { useService } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ICaptureService } from "../../services/captureService.js";
import { ILibraryService } from "../../services/libraryService.js";
import { Badge } from "../../components/Badge.js";
import { Spinner } from "../../components/Spinner.js";
import { intentKey } from "../../i18n/intent.js";
import { showToast } from "../../platform/toast.js";

const SELECTABLE: Intent[] = ["note", "bookmark", "todo"];

export function CaptureCard(props: { capture: Capture }): ReactNode {
  const { capture } = props;
  const { t } = useTranslation();
  const captureService = useService(ICaptureService);
  const library = useService(ILibraryService);

  const classifying = capture.status === "classifying";
  const data = capture.classification || capture.rulePreview;
  const primary = data.primaryIntent === "mixed" ? "mixed" : data.primaryIntent;

  const [title, setTitle] = useState(data.title || "");
  const [tags, setTags] = useState((data.tags || []).join(", "));
  const [intent, setIntent] = useState<Intent>(SELECTABLE.includes(primary as Intent) ? (primary as Intent) : "note");
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
          tags: tags.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      showToast(t("saved"));
      await library.refresh();
    } catch (error) {
      showToast((error as Error).message);
      setBusy(false);
    }
  }

  async function reject(): Promise<void> {
    await captureService.reject(capture.id);
    showToast(t("discarded"));
  }

  return (
    <div className={`card intent-${intent}`}>
      <div className="card-head">
        <div className="row">
          <Badge intent={intent} label={t(intentKey(intent))} />
          {!classifying && data.confidence > 0 && (
            <span className="hint">
              {t("confidence")} {Math.round(data.confidence * 100)}%
            </span>
          )}
          {classifying && (
            <>
              <Spinner />
              <span className="hint">{t("classifying")}</span>
            </>
          )}
        </div>
      </div>

      {capture.status === "needs_review" && <div className="error-text">{t("needsReview")}</div>}

      <div className="field">
        <label>{t("title")}</label>
        <input type="text" value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>

      {data.summary && <div className="summary">{data.summary}</div>}

      <div className="field">
        <label>{t("tags")}</label>
        <input type="text" value={tags} onChange={(event) => setTags(event.target.value)} />
      </div>

      <div className="alts">
        {SELECTABLE.map((option) => (
          <button
            key={option}
            className={option === intent ? "active" : ""}
            onClick={() => setIntent(option)}
          >
            {t(intentKey(option))}
          </button>
        ))}
      </div>

      {showIssue && (
        <label className="checkbox">
          <input type="checkbox" checked={writeIssue} onChange={(event) => setWriteIssue(event.target.checked)} />
          {t("writeIssue")}
        </label>
      )}

      <div className="row end">
        <button className="danger" onClick={() => void reject()}>
          {t("reject")}
        </button>
        <button className="primary" disabled={classifying || busy} onClick={() => void confirm()}>
          {t("confirm")}
        </button>
      </div>
    </div>
  );
}
