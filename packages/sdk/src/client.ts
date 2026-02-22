import { HttpTransport } from "./http.js";
import { DatasetsResource } from "./resources/datasets.js";
import { ExportsResource } from "./resources/exports.js";
import { ProjectsResource } from "./resources/projects.js";
import { TasksResource } from "./resources/tasks.js";
import type { AvalaConfig } from "./types.js";

export class Avala {
  public readonly datasets: DatasetsResource;
  public readonly projects: ProjectsResource;
  public readonly exports: ExportsResource;
  public readonly tasks: TasksResource;

  constructor(config?: AvalaConfig) {
    const apiKey = config?.apiKey ?? (typeof process !== "undefined" ? process.env.AVALA_API_KEY : undefined);
    if (!apiKey) {
      throw new Error(
        "No API key provided. Pass apiKey in config or set the AVALA_API_KEY environment variable."
      );
    }

    const http = new HttpTransport({
      apiKey,
      baseUrl: (config?.baseUrl ?? "https://server.avala.ai/api/v1").replace(/\/+$/, ""),
      timeout: config?.timeout ?? 30_000,
    });

    this.datasets = new DatasetsResource(http);
    this.projects = new ProjectsResource(http);
    this.exports = new ExportsResource(http);
    this.tasks = new TasksResource(http);
  }
}
