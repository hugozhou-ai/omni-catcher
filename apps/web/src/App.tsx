import { useEffect, useState, type ReactNode } from "react";
import { Toast } from "./components/Toast.js";
import { Sidebar, type AppView } from "./components/Sidebar.js";
import { CaptureHome } from "./features/capture/CaptureHome.js";
import { TodoPanel } from "./features/todo/TodoPanel.js";
import { CollectionPanel } from "./features/library/CollectionPanel.js";
import { useService } from "./platform/react.js";
import { ILocalizationService } from "./services/localizationService.js";
import { ICaptureService } from "./services/captureService.js";

export function App(): ReactNode {
  const localization = useService(ILocalizationService);
  const captureService = useService(ICaptureService);
  const [view, setView] = useState<AppView>("home");

  useEffect(() => {
    void localization.init();
    void captureService.refresh().then((classifying) => {
      if (classifying) captureService.startPolling();
    });
  }, [localization, captureService]);

  return (
    <div className="shell">
      <Sidebar active={view} onNavigate={setView} />
      <main className={`main ${view === "home" ? "main-home" : ""}`}>{renderMain(view)}</main>
      <Toast />
    </div>
  );
}

function renderMain(view: AppView): ReactNode {
  switch (view) {
    case "home":
      return <CaptureHome />;
    case "todo":
      return <TodoPanel />;
    case "note":
      return <CollectionPanel type="note" />;
    case "bookmark":
      return <CollectionPanel type="bookmark" />;
    default:
      return <CaptureHome />;
  }
}
