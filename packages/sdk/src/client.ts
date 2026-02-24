import { HttpTransport } from "./http.js";
import { AgentsResource } from "./resources/agents.js";
import { AutoLabelJobsResource } from "./resources/autoLabelJobs.js";
import { ConsensusResource } from "./resources/consensus.js";
import { DatasetsResource } from "./resources/datasets.js";
import { ExportsResource } from "./resources/exports.js";
import { InferenceProvidersResource } from "./resources/inferenceProviders.js";
import { ProjectsResource } from "./resources/projects.js";
import { QualityTargetsResource } from "./resources/qualityTargets.js";
import { StorageConfigsResource } from "./resources/storageConfigs.js";
import { TasksResource } from "./resources/tasks.js";
import { WebhookDeliveriesResource, WebhooksResource } from "./resources/webhooks.js";
import type { AvalaConfig, RateLimitInfo } from "./types.js";

export class Avala {
  public readonly datasets: DatasetsResource;
  public readonly projects: ProjectsResource;
  public readonly exports: ExportsResource;
  public readonly tasks: TasksResource;
  public readonly storageConfigs: StorageConfigsResource;
  public readonly agents: AgentsResource;
  public readonly inferenceProviders: InferenceProvidersResource;
  public readonly autoLabelJobs: AutoLabelJobsResource;
  public readonly qualityTargets: QualityTargetsResource;
  public readonly consensus: ConsensusResource;
  public readonly webhooks: WebhooksResource;
  public readonly webhookDeliveries: WebhookDeliveriesResource;

  private readonly http: HttpTransport;

  constructor(config?: AvalaConfig) {
    const apiKey = config?.apiKey ?? (typeof process !== "undefined" ? process.env.AVALA_API_KEY : undefined);
    if (!apiKey) {
      throw new Error(
        "No API key provided. Pass apiKey in config or set the AVALA_API_KEY environment variable."
      );
    }

    this.http = new HttpTransport({
      apiKey,
      baseUrl: (config?.baseUrl ?? "https://api.avala.ai/api/v1").replace(/\/+$/, ""),
      timeout: config?.timeout ?? 30_000,
    });

    this.datasets = new DatasetsResource(this.http);
    this.projects = new ProjectsResource(this.http);
    this.exports = new ExportsResource(this.http);
    this.tasks = new TasksResource(this.http);
    this.storageConfigs = new StorageConfigsResource(this.http);
    this.agents = new AgentsResource(this.http);
    this.inferenceProviders = new InferenceProvidersResource(this.http);
    this.autoLabelJobs = new AutoLabelJobsResource(this.http);
    this.qualityTargets = new QualityTargetsResource(this.http);
    this.consensus = new ConsensusResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
    this.webhookDeliveries = new WebhookDeliveriesResource(this.http);
  }

  get rateLimitInfo(): RateLimitInfo {
    return this.http.lastRateLimit;
  }
}
