import { HttpTransport } from "./http.js";
import { AgentsResource } from "./resources/agents.js";
import { FleetResource } from "./resources/fleet/index.js";
import { AnnotationIssuesResource } from "./resources/annotationIssues.js";
import { AutoLabelJobsResource } from "./resources/autoLabelJobs.js";
import { ConsensusResource } from "./resources/consensus.js";
import { DatasetsResource } from "./resources/datasets.js";
import { ExportsResource } from "./resources/exports.js";
import { InferenceProvidersResource } from "./resources/inferenceProviders.js";
import { OrganizationsResource } from "./resources/organizations.js";
import { ProjectsResource } from "./resources/projects.js";
import { QualityTargetsResource } from "./resources/qualityTargets.js";
import { SlicesResource } from "./resources/slices.js";
import { StorageConfigsResource } from "./resources/storageConfigs.js";
import { TasksResource } from "./resources/tasks.js";
import { WebhookDeliveriesResource, WebhooksResource } from "./resources/webhooks.js";
import type { AvalaConfig, RateLimitInfo } from "./types.js";

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function resolveBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const allowInsecure = isTruthy(
    typeof process !== "undefined" ? process.env.AVALA_ALLOW_INSECURE_BASE_URL : undefined,
  );

  if (parsed.protocol !== "https:") {
    if (!allowInsecure) {
      throw new Error(
        "AVALA base URL must use https:. Set AVALA_ALLOW_INSECURE_BASE_URL=true only for local development.",
      );
    }

    if (parsed.protocol !== "http:") {
      throw new Error(
        "With AVALA_ALLOW_INSECURE_BASE_URL=true, only http://localhost URLs are permitted.",
      );
    }
    if (!isLocalHost(parsed.hostname)) {
      throw new Error("Non-HTTPS base URLs are restricted to localhost addresses.");
    }
  }

  return baseUrl.replace(/\/+$/, "");
}

export class Avala {
  public readonly datasets: DatasetsResource;
  public readonly projects: ProjectsResource;
  public readonly exports: ExportsResource;
  public readonly tasks: TasksResource;
  public readonly storageConfigs: StorageConfigsResource;
  public readonly agents: AgentsResource;
  public readonly annotationIssues: AnnotationIssuesResource;
  public readonly inferenceProviders: InferenceProvidersResource;
  public readonly autoLabelJobs: AutoLabelJobsResource;
  public readonly qualityTargets: QualityTargetsResource;
  public readonly consensus: ConsensusResource;
  public readonly webhooks: WebhooksResource;
  public readonly webhookDeliveries: WebhookDeliveriesResource;
  public readonly organizations: OrganizationsResource;
  public readonly slices: SlicesResource;
  public readonly fleet: FleetResource;

  private readonly http: HttpTransport;

  constructor(config?: AvalaConfig) {
    const apiKey = config?.apiKey ?? (typeof process !== "undefined" ? process.env.AVALA_API_KEY : undefined);
    if (!apiKey) {
      throw new Error(
        "No API key provided. Pass apiKey in config or set the AVALA_API_KEY environment variable."
      );
    }

    const baseUrl = resolveBaseUrl(config?.baseUrl ?? "https://api.avala.ai/api/v1");
    this.http = new HttpTransport({
      apiKey,
      baseUrl,
      timeout: config?.timeout ?? 30_000,
    });

    this.datasets = new DatasetsResource(this.http);
    this.projects = new ProjectsResource(this.http);
    this.exports = new ExportsResource(this.http);
    this.tasks = new TasksResource(this.http);
    this.storageConfigs = new StorageConfigsResource(this.http);
    this.agents = new AgentsResource(this.http);
    this.annotationIssues = new AnnotationIssuesResource(this.http);
    this.inferenceProviders = new InferenceProvidersResource(this.http);
    this.autoLabelJobs = new AutoLabelJobsResource(this.http);
    this.qualityTargets = new QualityTargetsResource(this.http);
    this.consensus = new ConsensusResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
    this.webhookDeliveries = new WebhookDeliveriesResource(this.http);
    this.organizations = new OrganizationsResource(this.http);
    this.slices = new SlicesResource(this.http);
    this.fleet = new FleetResource(this.http);
  }

  get rateLimitInfo(): RateLimitInfo {
    return this.http.lastRateLimit;
  }
}
