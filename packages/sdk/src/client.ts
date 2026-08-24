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

export function resolveBaseUrl(baseUrl: string): string {
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

  /**
   * The hardened HTTP transport shared by every typed resource client.
   *
   * This is public for declarative consumers such as the Avala MCP catalog,
   * where the reviewed route metadata must drive the actual HTTP method and
   * path. Keeping one transport preserves the SDK's credential forwarding,
   * redirect refusal, traversal checks, timeouts, error redaction, and rate
   * limit tracking for both typed resources and declarative calls.
   */
  public readonly transport: HttpTransport;

  constructor(config?: AvalaConfig) {
    const apiKey = config?.apiKey ?? (typeof process !== "undefined" ? process.env.AVALA_API_KEY : undefined);
    if (!apiKey) {
      throw new Error(
        "No API key provided. Pass apiKey in config or set the AVALA_API_KEY environment variable."
      );
    }

    const baseUrl = resolveBaseUrl(config?.baseUrl ?? "https://api.avala.ai/api/v1");
    this.transport = new HttpTransport({
      apiKey,
      baseUrl,
      timeout: config?.timeout ?? 30_000,
    });

    this.datasets = new DatasetsResource(this.transport);
    this.projects = new ProjectsResource(this.transport);
    this.exports = new ExportsResource(this.transport);
    this.tasks = new TasksResource(this.transport);
    this.storageConfigs = new StorageConfigsResource(this.transport);
    this.agents = new AgentsResource(this.transport);
    this.annotationIssues = new AnnotationIssuesResource(this.transport);
    this.inferenceProviders = new InferenceProvidersResource(this.transport);
    this.autoLabelJobs = new AutoLabelJobsResource(this.transport);
    this.qualityTargets = new QualityTargetsResource(this.transport);
    this.consensus = new ConsensusResource(this.transport);
    this.webhooks = new WebhooksResource(this.transport);
    this.webhookDeliveries = new WebhookDeliveriesResource(this.transport);
    this.organizations = new OrganizationsResource(this.transport);
    this.slices = new SlicesResource(this.transport);
    this.fleet = new FleetResource(this.transport);
  }

  get rateLimitInfo(): RateLimitInfo {
    return this.transport.lastRateLimit;
  }
}
