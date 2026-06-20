import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { useService } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ICaptureService } from "../../services/captureService.js";
import { IWorkspaceService } from "../../services/workspaceService.js";
import { showToast } from "../../platform/toast.js";

export function CapturePanel(): ReactNode {
  const { t } = useTranslation();
  const captureService = useService(ICaptureService);
  const workspace = useService(IWorkspaceService);
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerHint, setProviderHint] = useState("");

  useEffect(() => {
    void workspace.getProviders().then((result) => {
      setProviderHint(
        result.available && result.providers.length
          ? t("providerReady") + result.providers.map((p) => p.provider).join(", ")
          : t("providerNone"),
      );
    });
  }, [workspace, t]);

  async function submit(): Promise<void> {
    const text = content.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await captureService.create(text);
      setContent("");
    } catch (error) {
      showToast((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
  }

  return (
    <section className="panel">
      <h2>{t("captureTitle")}</h2>
      <textarea
        value={content}
        placeholder={t("capturePlaceholder")}
        onChange={(event) => setContent(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="row end">
        <span className="hint">{providerHint}</span>
        <button className="primary" disabled={busy} onClick={() => void submit()}>
          {t("captureButton")}
        </button>
      </div>
    </section>
  );
}
