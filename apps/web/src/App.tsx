import { useEffect, useState, type ReactNode } from "react";
import { useService } from "./platform/react.js";
import { useTranslation } from "./hooks/useTranslation.js";
import { ILocalizationService } from "./services/localizationService.js";
import { IWorkspaceService } from "./services/workspaceService.js";
import { ICaptureService } from "./services/captureService.js";
import { ILibraryService } from "./services/libraryService.js";
import { CapturePanel } from "./features/capture/CapturePanel.js";
import { PendingPanel } from "./features/pending/PendingPanel.js";
import { LibraryPanel } from "./features/library/LibraryPanel.js";
import { Toast } from "./components/Toast.js";

export function App(): ReactNode {
  const { t } = useTranslation();
  const localization = useService(ILocalizationService);
  const workspace = useService(IWorkspaceService);
  const captureService = useService(ICaptureService);
  const library = useService(ILibraryService);
  const [workspaceName, setWorkspaceName] = useState("");

  useEffect(() => {
    void localization.init();
    void workspace.getContext().then((context) => setWorkspaceName(context?.workspaceName || ""));
    void captureService.refresh().then((classifying) => {
      if (classifying) captureService.startPolling();
    });
    void library.refresh();
  }, [localization, workspace, captureService, library]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t("appName")}</h1>
        <span className="meta">{workspaceName}</span>
      </header>
      <CapturePanel />
      <PendingPanel />
      <LibraryPanel />
      <Toast />
    </div>
  );
}
