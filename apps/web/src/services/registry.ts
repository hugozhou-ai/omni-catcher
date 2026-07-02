import {
  InstantiationService,
  ServiceCollection,
  type IInstantiationService,
} from "@omni-catcher/shared/platform";
import { IApiService, HttpApiService } from "./apiService.js";
import { IHostBridgeService, HostBridgeService } from "./hostBridgeService.js";
import { ILocalizationService, LocalizationService } from "./localizationService.js";
import { IThemeService, ThemeService } from "./themeService.js";
import { IWorkspaceService, WorkspaceService } from "./workspaceService.js";
import { ICaptureService, WebCaptureService } from "./captureService.js";
import { ILibraryService, LibraryService } from "./libraryService.js";

export function createWebServices(): IInstantiationService {
  const collection = new ServiceCollection();

  const api = new HttpApiService();
  const host = new HostBridgeService();
  const localization = new LocalizationService(host);
  const theme = new ThemeService(host);
  const workspace = new WorkspaceService(api);
  const capture = new WebCaptureService(api);
  const library = new LibraryService(api);

  collection.set(IApiService, api);
  collection.set(IHostBridgeService, host);
  collection.set(ILocalizationService, localization);
  collection.set(IThemeService, theme);
  collection.set(IWorkspaceService, workspace);
  collection.set(ICaptureService, capture);
  collection.set(ILibraryService, library);

  return new InstantiationService(collection);
}
