import { useState, type ReactNode } from "react";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";
import { useTranslation } from "../hooks/useTranslation.js";
import { useService, useStore } from "../platform/react.js";
import { IThemeService } from "../services/themeService.js";

export function MarkdownEditor(props: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}): ReactNode {
  const { value, onChange, disabled = false } = props;
  const { t } = useTranslation();
  const themeService = useService(IThemeService);
  const theme = useStore(themeService.theme);
  const [mode, setMode] = useState<"edit" | "preview">("edit");

  return (
    <div className="markdown-editor-shell" data-color-mode={theme}>
      <div className="markdown-editor-toolbar">
        <button
          type="button"
          className={mode === "edit" ? "active" : ""}
          disabled={disabled}
          onClick={() => setMode("edit")}
        >
          {t("editMode")}
        </button>
        <button
          type="button"
          className={mode === "preview" ? "active" : ""}
          disabled={disabled}
          onClick={() => setMode("preview")}
        >
          {t("previewMode")}
        </button>
      </div>
      <MDEditor
        value={value}
        onChange={(next) => {
          if (disabled) return;
          onChange(next ?? "");
        }}
        preview={mode}
        hideToolbar
        visibleDragbar={false}
        height={480}
        textareaProps={{ disabled, spellCheck: true }}
      />
    </div>
  );
}
