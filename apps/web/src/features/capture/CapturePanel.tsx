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
  const [providers, setProviders] = useState<string[]>([]);
  const [providerHint, setProviderHint] = useState("");
  const [preferred, setPreferred] = useState("");

  useEffect(() => {
    void Promise.all([workspace.getProviders(), workspace.getPreferredProvider()]).then(
      ([result, saved]) => {
        const names = result.providers.map((p) => p.provider);
        setProviders(names);
        setPreferred(names.includes(saved) ? saved : "");
        setProviderHint(
          result.available && names.length ? "" : t("providerNone"),
        );
      },
    );
  }, [workspace, t]);

  function onProviderChange(value: string): void {
    setPreferred(value);
    void workspace.setPreferredProvider(value);
  }

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
        {providerHint ? <span className="hint">{providerHint}</span> : null}
        {providers.length ? (
          <label className="provider-select">
            <span className="hint">{t("providerLabel")}</span>
            <select value={preferred} onChange={(event) => onProviderChange(event.target.value)}>
              <option value="">{t("providerDefaultOption")}</option>
              {providers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button className="primary" disabled={busy} onClick={() => void submit()}>
          {t("captureButton")}
        </button>
      </div>
    </section>
  );
}
