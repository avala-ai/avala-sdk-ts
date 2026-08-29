import type { CursorPage, Project } from "../types.js";
import { BaseResource } from "./base.js";

/**
 * Projects come from two different Django views with different permissions,
 * and picking the wrong one is a silent 403 rather than an obvious error.
 *
 * - `/projects/` is `ProjectViewSet`, permission
 *   `[IsStaffAndNotApiKeyOrStaffApiKey]`. Staff only — and it additionally
 *   refuses a staff member's ORDINARY data-plane key (pentest `apikey/s3-2`),
 *   so a customer credential can never pass it and neither can most staff
 *   automation.
 * - `/users/me/projects/` is `UserProjectViewSet`, permission
 *   `(IsOwner & IsCustomer) | IsStaffAndNotApiKeyOrStaffApiKey`. This is the
 *   customer-visible surface.
 *
 * Both use the same serializers (`ProjectSerializer` for list,
 * `ProjectRetrieveSerializer` for retrieve), so the response shapes match and
 * choosing correctly costs nothing.
 */
export class ProjectsResource extends BaseResource {
  /**
   * List every project on the instance. **Staff-only.**
   *
   * Returns 403 for customer credentials and for a staff member's ordinary API
   * key. If you are acting on behalf of a signed-in user, you want
   * {@link listMine}.
   */
  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<Project>> {
    return this.http.requestPage<Project>("/projects/", pageParams(options));
  }

  /** Get any project by uid. **Staff-only**, same caveat as {@link list}. */
  async get(uid: string): Promise<Project> {
    return this.http.requestSingle<Project>(`/projects/${uid}/`);
  }

  /** List the projects the calling credential can actually see. */
  async listMine(options?: { limit?: number; cursor?: string }): Promise<CursorPage<Project>> {
    return this.http.requestPage<Project>("/users/me/projects/", pageParams(options));
  }

  /** Get one of the calling credential's own projects by uid. */
  async getMine(uid: string): Promise<Project> {
    return this.http.requestSingle<Project>(`/users/me/projects/${uid}/`);
  }
}

function pageParams(options?: { limit?: number; cursor?: string }): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  if (options?.limit !== undefined) params.limit = String(options.limit);
  if (options?.cursor) params.cursor = options.cursor;
  return Object.keys(params).length > 0 ? params : undefined;
}
