import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { Capture, CaptureProgress } from "@omni-catcher/shared";
import { useService, useStore } from "../../platform/react.js";
import { useTranslation } from "../../hooks/useTranslation.js";
import { ICaptureService } from "../../services/captureService.js";
import { IWorkspaceService } from "../../services/workspaceService.js";
import { Spinner } from "../../components/Spinner.js";
import { DecisionCard } from "./DecisionCard.js";
import { showToast } from "../../platform/toast.js";

type Phase = "idle" | "processing" | "review";
type CaretBox = { height: number; visible: boolean; x: number; y: number };

function toEvenPixel(value: number): number {
  return Math.max(0, Math.round(value / 2) * 2);
}

function toEvenOffset(value: number): number {
  return Math.round(value / 2) * 2;
}

function resolveTextareaCaret(textarea: HTMLTextAreaElement): CaretBox {
  const computed = window.getComputedStyle(textarea);
  const marker = document.createElement("span");
  const mirror = document.createElement("div");
  const selectionStart = textarea.selectionStart ?? 0;

  mirror.style.position = "absolute";
  mirror.style.top = "-10000px";
  mirror.style.left = "-10000px";
  mirror.style.visibility = "hidden";
  mirror.style.boxSizing = "border-box";
  mirror.style.width = `${toEvenPixel(textarea.clientWidth)}px`;
  mirror.style.minHeight = `${toEvenPixel(textarea.clientHeight)}px`;
  mirror.style.border = computed.border;
  mirror.style.padding = computed.padding;
  mirror.style.font = computed.font;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = "break-word";

  mirror.textContent = textarea.value.slice(0, selectionStart) || "\u200b";
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const lineHeight = Number.parseFloat(computed.lineHeight) || 26;
  const fontSize = Number.parseFloat(computed.fontSize) || 16;
  const height = toEvenPixel(Math.min(lineHeight, Math.max(fontSize + 6, lineHeight - 4)));
  const x = toEvenPixel(markerRect.left - mirrorRect.left - textarea.scrollLeft);
  const y = toEvenOffset(markerRect.top - mirrorRect.top - textarea.scrollTop + (lineHeight - height) / 2 - 4);

  mirror.remove();
  return { height, visible: document.activeElement === textarea, x, y };
}

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caretBox, setCaretBox] = useState<CaretBox>({ height: 22, visible: false, x: 24, y: 18 });

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

  useEffect(() => {
    if (activeId || captures.length === 0) return;
    const waiting = captures.find((capture) => capture.status === "classifying") ?? captures[0];
    if (waiting) {
      setActiveId(waiting.id);
      setSubmitted(waiting.content);
    }
  }, [activeId, captures]);

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

  function refreshCaret(): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    window.requestAnimationFrame(() => {
      const current = textareaRef.current;
      if (!current) return;
      setCaretBox(resolveTextareaCaret(current));
    });
  }

  useLayoutEffect(() => {
    if (phase !== "idle") return;
    refreshCaret();
  }, [content, phase]);

  const caretStyle: CSSProperties = {
    height: `${caretBox.height}px`,
    transform: `translate(${caretBox.x}px, ${caretBox.y}px)`,
  };

  return (
    <div className="capture-home">
      <div className="capture-hero">
        <div className="capture-brand">
          <div className="capture-logo-frame">
            <img src="/omni-catcher-logo-large.webp" alt="Omni Catcher" className="capture-logo" />
          </div>
        </div>
      </div>

      {phase !== "idle" && submitted ? (
        <blockquote className="capture-quote">{submitted}</blockquote>
      ) : null}

      {phase === "processing" ? (
        <div className="capture-processing">
          <Spinner />
          <div>
            <p>{progressText(activeCapture?.progress, t)}</p>
            <span>{t("classifying")}</span>
          </div>
        </div>
      ) : null}

      {phase === "review" && activeCapture ? (
        <DecisionCard capture={activeCapture} onDone={reset} />
      ) : null}

      {phase === "idle" ? (
        <div className="capture-sheet">
          <div className="capture-textarea-wrap">
            <textarea
              ref={textareaRef}
              className="capture-textarea"
              value={content}
              placeholder={t("capturePlaceholder")}
              onBlur={() => setCaretBox((box) => ({ ...box, visible: false }))}
              onChange={(event) => {
                setContent(event.target.value);
                refreshCaret();
              }}
              onClick={refreshCaret}
              onFocus={refreshCaret}
              onKeyDown={onKeyDown}
              onKeyUp={refreshCaret}
              onScroll={refreshCaret}
              onSelect={refreshCaret}
            />
            <span
              aria-hidden="true"
              className={`capture-custom-caret ${caretBox.visible ? "visible" : ""}`}
              style={caretStyle}
            />
          </div>
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

function progressText(
  progress: CaptureProgress | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (progress) {
    case "preparing":
      return t("progressPreparing");
    case "finding_related":
      return t("progressFindingRelated");
    case "preparing_context":
      return t("progressPreparingContext");
    case "fetching_pages":
      return t("progressFetchingPages");
    case "browser_pages":
      return t("progressBrowserPages");
    case "calling_agent":
      return t("progressCallingAgent");
    case "finalizing":
      return t("progressFinalizing");
    case "fallback":
      return t("progressFallback");
    default:
      return t("classifying");
  }
}
