import { HttpTransport } from "./http.js";
import { DatasetsResource } from "./resources/datasets.js";
import { ExportsResource } from "./resources/exports.js";
import { ProjectsResource } from "./resources/projects.js";
import { StorageConfigsResource } from "./resources/storageConfigs.js";
import { TasksResource } from "./resources/tasks.js";
import type { AvalaConfig, RateLimitInfo } from "./types.js";

export class Avala {
  public readonly datasets: DatasetsResource;
  public readonly projects: ProjectsResource;
  public readonly exports: ExportsResource;
  public readonly tasks: TasksResource;
  public readonly storageConfigs: StorageConfigsResource;

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
      baseUrl: (config?.baseUrl ?? "https://server.avala.ai/api/v1").replace(/\/+$/, ""),
      timeout: config?.timeout ?? 30_000,
    });

    this.datasets = new DatasetsResource(this.http);
    this.projects = new ProjectsResource(this.http);
    this.exports = new ExportsResource(this.http);
    this.tasks = new TasksResource(this.http);
    this.storageConfigs = new StorageConfigsResource(this.http);
  }

  get rateLimitInfo(): RateLimitInfo {
    return this.http.lastRateLimit;
  }
}
