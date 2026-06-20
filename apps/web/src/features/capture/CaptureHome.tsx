import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Capture } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ICaptureService } from "../../services/captureService.js";
import { IWorkspaceService } from "../../services/workspaceService.js";
import { Spinner } from "../../components/Spinner.js";
import { DecisionCard } from "./DecisionCard.js";
import { showToast } from "../../platform/toast.js";

type Phase = "idle" | "processing" | "review";

export function CaptureHome(): ReactNode {
  const { t } = useTranslation();
  const captureService = useService(ICaptureService);
  const workspace = useService(IWorkspaceService);
  const captures = useStore(captureService.captures);

  const [content, setContent] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<string[]>([]);
  const [providerHint, setProviderHint] = useState("");
  const [preferred, setPreferred] = useState("");

  const activeCapture: Capture | null =
    activeId ? captures.find((c) => c.id === activeId) ?? null : null;

  const phase: Phase = !activeCapture
    ? "idle"
    : activeCapture.status === "classifying"
      ? "processing"
      : "review";

  useEffect(() => {
    void Promise.all([workspace.getProviders(), workspace.getPreferredProvider()]).then(
      ([result, saved]) => {
        const names = result.providers.map((p) => p.provider);
        setProviders(names);
        setPreferred(names.includes(saved) ? saved : "");
        setProviderHint(result.available && names.length ? "" : t("providerNone"));
      },
    );
  }, [workspace, t]);

  function reset(): void {
    setContent("");
    setSubmitted("");
    setActiveId(null);
    setBusy(false);
  }

  function onProviderChange(value: string): void {
    setPreferred(value);
    void workspace.setPreferredProvider(value);
  }

  async function submit(): Promise<void> {
    const text = content.trim();
    if (!text || busy || phase !== "idle") return;
    setBusy(true);
    setSubmitted(text);
    try {
      const capture = await captureService.create(text);
      setActiveId(capture.id);
    } catch (error) {
      showToast((error as Error).message);
      reset();
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && phase === "idle") {
      void submit();
    }
  }

  return (
    <div className="capture-home">
      <div className="capture-brand">
        <div className="capture-logo-frame">
          <img src="/omni-catcher-logo.png" alt="Omni Catcher" className="capture-logo" />
        </div>
      </div>

      {phase !== "idle" && submitted ? (
        <blockquote className="capture-quote">{submitted}</blockquote>
      ) : null}

      {phase === "processing" ? (
        <div className="capture-processing">
          <Spinner />
          <p>{t("classifying")}</p>
        </div>
      ) : null}

      {phase === "review" && activeCapture ? (
        <DecisionCard capture={activeCapture} onDone={reset} />
      ) : null}

      {phase === "idle" ? (
        <div className="capture-sheet">
          <textarea
            className="capture-textarea"
            value={content}
            placeholder={t("capturePlaceholder")}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="capture-input-bar">
            <div className="capture-input-meta">
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
            </div>
            <button
              type="button"
              className="primary capture-submit"
              disabled={!content.trim() || busy}
              onClick={() => void submit()}
            >
              {t("captureButton")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
