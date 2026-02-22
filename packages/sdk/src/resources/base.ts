import type { HttpTransport } from "../http.js";

export class BaseResource {
  protected readonly http: HttpTransport;

  constructor(http: HttpTransport) {
    this.http = http;
  }
}
