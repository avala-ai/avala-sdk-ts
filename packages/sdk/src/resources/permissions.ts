import type { CredentialPermissions } from "../types.js";
import { BaseResource } from "./base.js";

/** Discover the capabilities granted to the current credential. */
export class PermissionsResource extends BaseResource {
  async get(): Promise<CredentialPermissions> {
    return this.http.requestSingle<CredentialPermissions>("/users/me/permissions/");
  }
}
