import { useState, type ReactNode } from "react";
import type { Capture, Intent } from "@omni-catcher/shared";

import { Badge } from "../../components/Badge.js";
import { MarkdownViewer } from "../../components/MarkdownViewer.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { useService } from "../../platform/react.js";
import { showToast } from "../../platform/toast.js";
import { ICaptureService } from "../../services/captureService.js";
import { ILibraryService } from "../../services/libraryService.js";
import { intentKey } from "../../i18n/intent.js";

export function AgentResultCard(props: { capture: Capture; onDone: () => void }): ReactNode {
  const { capture, onDone } = props;
  const result = capture.agentResult;
  const { t } = useTranslation();
  const captures = useService(ICaptureService);
  const library = useService(ILibraryService);
  const [busy, setBusy] = useState(false);
  if (!result) return null;
  const data = result;

  async function complete(): Promise<void> {
    setBusy(true);
    try {
      const intent: Intent = data.intents.length > 1 ? "mixed" : data.intents[0] || "note";
      await captures.confirm(capture.id, { intent, writeIssue: false, edits: {} });
      await library.refresh();
      showToast(t("agentCompleted"), "success");
      onDone();
    } catch (error) {
      showToast((error as Error).message, "error");
      setBusy(false);
    }
  }

  return (
    <section className="decision-card agent-result-card">
      <header className="agent-result-head">
        <div>
          <span className="decision-kicker">{t("agentResult")}</span>
          <h2>{t(purposeKey(data.purpose))}</h2>
        </div>
        <div className="agent-result-intents">
          {data.intents.map((intent) => (
            <Badge key={intent} intent={intent} label={t(intentKey(intent))} />
          ))}
        </div>
      </header>

      <p className="agent-result-summary">{data.summary}</p>

      {data.answer ? (
        <div className="agent-result-answer scroll-thin">
          <MarkdownViewer markdown={data.answer} />
        </div>
      ) : null}

      {data.changedFiles.length ? (
        <div className="agent-result-files">
          <strong>{t("changedFiles")}</strong>
          <ul>
            {data.changedFiles.map((path) => <li key={path}>{path}</li>)}
          </ul>
        </div>
      ) : data.purpose !== "query" ? <p className="hint">{t("noChangedFiles")}</p> : null}

      <div className="decision-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void complete()}>
          {busy ? t("saving") : t("done")}
        </button>
      </div>
    </section>
  );
}

function purposeKey(purpose: "create" | "organize" | "query"):
  | "purposeCreate"
  | "purposeOrganize"
  | "purposeQuery" {
  if (purpose === "organize") return "purposeOrganize";
  if (purpose === "query") return "purposeQuery";
  return "purposeCreate";
}
