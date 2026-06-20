import {
  ConsoleLogService,
  ILogService,
  InstantiationService,
  ServiceCollection,
  type IInstantiationService,
} from "@omni-catcher/shared/platform";
import { IAppConfig, type AppConfig } from "./config.js";
import { ITuttiCliService, TuttiCliService } from "./services/tuttiCliService.js";
import { IAgentService, AgentService } from "./services/agentService.js";
import { IClassificationService, ClassificationService } from "./services/classificationService.js";
import { IStorageService, StorageService } from "./services/storageService.js";
import { IIssueService, IssueService } from "./services/issueService.js";
import { IReferenceService, ReferenceService } from "./services/referenceService.js";
import { ICaptureService, CaptureService } from "./services/captureService.js";

export function createServices(config: AppConfig): IInstantiationService {
  const collection = new ServiceCollection();

  const log = new ConsoleLogService("omni-catcher");
  const cli = new TuttiCliService(log);
  const agent = new AgentService(cli);
  const classification = new ClassificationService(config);
  const storage = new StorageService(config);
  const issues = new IssueService(cli);
  const reference = new ReferenceService(storage);
  const capture = new CaptureService(config, storage, classification, agent, issues, log);

  collection.set(IAppConfig, config);
  collection.set(ILogService, log);
  collection.set(ITuttiCliService, cli);
  collection.set(IAgentService, agent);
  collection.set(IClassificationService, classification);
  collection.set(IStorageService, storage);
  collection.set(IIssueService, issues);
  collection.set(IReferenceService, reference);
  collection.set(ICaptureService, capture);

  return new InstantiationService(collection);
}
