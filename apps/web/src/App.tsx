import { useEffect, useState, type ReactNode } from "react";
import { Toast } from "./components/Toast.js";
import { Sidebar, type AppView } from "./components/Sidebar.js";
import { TooltipProvider } from "./components/primitives/Tooltip.js";
import { CaptureHome } from "./features/capture/CaptureHome.js";
import { LibraryPanel } from "./features/library/LibraryPanel.js";
import {
  DEFAULT_LIBRARY_SELECTION,
  type LibraryCategory,
  type LibrarySelection,
} from "./features/library/libraryNavigation.js";
import { useService } from "./platform/react.js";
import { ILocalizationService } from "./services/localizationService.js";
import { ICaptureService } from "./services/captureService.js";
import { ILibraryService } from "./services/libraryService.js";
import { IThemeService } from "./services/themeService.js";

export function App(): ReactNode {
  const localization = useService(ILocalizationService);
  const theme = useService(IThemeService);
  const captureService = useService(ICaptureService);
  const library = useService(ILibraryService);
  const [view, setView] = useState<AppView>("capture");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [librarySelection, setLibrarySelection] = useState<LibrarySelection>(DEFAULT_LIBRARY_SELECTION);

  useEffect(() => {
    void localization.init();
    void theme.init();
    void captureService.refresh().then((classifying) => {
      if (classifying) captureService.startPolling();
    });
  }, [localization, theme, captureService]);

  useEffect(() => {
    if (view !== "library") return;
    void library.refresh();
  }, [library, view]);

  function navigate(viewId: AppView): void {
    setView(viewId);
    if (viewId === "library") setSidebarExpanded(true);
  }

  function navigateLibrary(category: LibraryCategory, itemId: string | null = null): void {
    setView("library");
    setSidebarExpanded(true);
    setLibrarySelection({ category, itemId });
  }

  return (
    <TooltipProvider>
      <div className={`shell ${drawerOpen ? "drawer-open" : ""}`}>
        <Sidebar
          active={view}
          expanded={sidebarExpanded}
          drawerOpen={drawerOpen}
          librarySelection={librarySelection}
          onNavigate={navigate}
          onExpandedChange={setSidebarExpanded}
          onDrawerOpenChange={setDrawerOpen}
          onLibraryNavigate={navigateLibrary}
        />
        <main className={`main ${view === "capture" ? "main-home" : "main-library"}`}>
          {view === "capture" ? (
            <CaptureHome />
          ) : (
            <LibraryPanel
              selection={librarySelection}
              onSelectItem={(itemId) =>
                setLibrarySelection((current) => ({ ...current, itemId }))
              }
              onGoCapture={() => navigate("capture")}
            />
          )}
        </main>
        <Toast />
      </div>
    </TooltipProvider>
  );
}
