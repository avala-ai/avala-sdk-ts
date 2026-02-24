import type {
  CursorPage,
  Invitation,
  Organization,
  OrganizationMember,
  Team,
  TeamMember,
} from "../types.js";
import { BaseResource } from "./base.js";

export interface CreateOrganizationOptions {
  name: string;
  description?: string;
  logo?: string;
  website?: string;
  industry?: string;
  email?: string;
  phone?: string;
  visibility?: string;
}

export interface UpdateOrganizationOptions {
  name?: string;
  description?: string;
  logo?: string;
  website?: string;
  handle?: string;
  industry?: string;
  email?: string;
  phone?: string;
  visibility?: string;
}

export interface CreateInvitationOptions {
  email: string;
  role?: string;
}

export interface CreateTeamOptions {
  name: string;
  description?: string;
  color?: string;
}

export interface UpdateTeamOptions {
  name?: string;
  description?: string;
  color?: string;
}

export class OrganizationsResource extends BaseResource {
  // Organizations

  async list(options?: { limit?: number; cursor?: string }): Promise<CursorPage<Organization>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<Organization>("/organizations/", Object.keys(params).length > 0 ? params : undefined);
  }

  async get(slug: string): Promise<Organization> {
    return this.http.requestSingle<Organization>(`/organizations/${slug}/`);
  }

  async create(options: CreateOrganizationOptions): Promise<Organization> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      logo: "logo",
      website: "website",
      industry: "industry",
      email: "email",
      phone: "phone",
      visibility: "visibility",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<Organization>("/organizations/", payload);
  }

  async update(slug: string, options: UpdateOrganizationOptions): Promise<Organization> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      logo: "logo",
      website: "website",
      handle: "handle",
      industry: "industry",
      email: "email",
      phone: "phone",
      visibility: "visibility",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestUpdate<Organization>(`/organizations/${slug}/`, payload);
  }

  async delete(slug: string): Promise<void> {
    await this.http.request("DELETE", `/organizations/${slug}/`);
  }

  async industryChoices(): Promise<Record<string, unknown>> {
    return this.http.request<Record<string, unknown>>("GET", "/organizations/industry-choices/");
  }

  // Members

  async listMembers(
    slug: string,
    options?: { search?: string; role?: string; limit?: number; cursor?: string },
  ): Promise<CursorPage<OrganizationMember>> {
    const params: Record<string, string> = {};
    if (options?.search) params.search = options.search;
    if (options?.role) params.role = options.role;
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor) params.cursor = options.cursor;
    return this.http.requestPage<OrganizationMember>(
      `/organizations/${slug}/members/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async removeMember(slug: string, userUid: string): Promise<void> {
    await this.http.request("DELETE", `/organizations/${slug}/members/${userUid}/`);
  }

  async updateMemberRole(slug: string, userUid: string, options: { role: string }): Promise<void> {
    await this.http.request("PATCH", `/organizations/${slug}/members/${userUid}/role/`, {
      json: { role: options.role },
    });
  }

  async leave(slug: string): Promise<void> {
    await this.http.request("POST", `/organizations/${slug}/leave/`);
  }

  async transferOwnership(slug: string, options: { newOwnerUid: string }): Promise<void> {
    await this.http.request("POST", `/organizations/${slug}/transfer-ownership/`, {
      json: { new_owner_uid: options.newOwnerUid },
    });
  }

  // Invitations

  async listInvitations(slug: string): Promise<Invitation[]> {
    return this.http.requestList<Invitation>(`/organizations/${slug}/invitations/`);
  }

  async createInvitation(slug: string, options: CreateInvitationOptions): Promise<Invitation> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      email: "email",
      role: "role",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<Invitation>(`/organizations/${slug}/invitations/`, payload);
  }

  async resendInvitation(slug: string, invitationUid: string): Promise<void> {
    await this.http.request("POST", `/organizations/${slug}/invitations/${invitationUid}/resend/`);
  }

  async cancelInvitation(slug: string, invitationUid: string): Promise<void> {
    await this.http.request("POST", `/organizations/${slug}/invitations/${invitationUid}/cancel/`);
  }

  // Teams

  async listTeams(slug: string): Promise<Team[]> {
    return this.http.requestList<Team>(`/organizations/${slug}/teams/`);
  }

  async createTeam(slug: string, options: CreateTeamOptions): Promise<Team> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      color: "color",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestCreate<Team>(`/organizations/${slug}/teams/`, payload);
  }

  async getTeam(slug: string, teamSlug: string): Promise<Team> {
    return this.http.requestSingle<Team>(`/organizations/${slug}/teams/${teamSlug}/`);
  }

  async updateTeam(slug: string, teamSlug: string, options: UpdateTeamOptions): Promise<Team> {
    const payload: Record<string, unknown> = {};
    const keyMap: Record<string, string> = {
      name: "name",
      description: "description",
      color: "color",
    };
    for (const [camel, snake] of Object.entries(keyMap)) {
      const value = (options as unknown as Record<string, unknown>)[camel];
      if (value !== undefined) payload[snake] = value;
    }
    return this.http.requestUpdate<Team>(`/organizations/${slug}/teams/${teamSlug}/`, payload);
  }

  async deleteTeam(slug: string, teamSlug: string): Promise<void> {
    await this.http.request("DELETE", `/organizations/${slug}/teams/${teamSlug}/`);
  }

  // Team Members

  async listTeamMembers(slug: string, teamSlug: string): Promise<TeamMember[]> {
    return this.http.requestList<TeamMember>(`/organizations/${slug}/teams/${teamSlug}/members/`);
  }

  async addTeamMember(
    slug: string,
    teamSlug: string,
    options: { userUid: string; role?: string },
  ): Promise<TeamMember> {
    const payload: Record<string, unknown> = { user_uid: options.userUid };
    if (options.role !== undefined) payload.role = options.role;
    return this.http.requestCreate<TeamMember>(`/organizations/${slug}/teams/${teamSlug}/members/`, payload);
  }

  async removeTeamMember(slug: string, teamSlug: string, userUid: string): Promise<void> {
    await this.http.request("DELETE", `/organizations/${slug}/teams/${teamSlug}/members/${userUid}/`);
  }

  async updateTeamMemberRole(
    slug: string,
    teamSlug: string,
    userUid: string,
    options: { role: string },
  ): Promise<void> {
    await this.http.request("PATCH", `/organizations/${slug}/teams/${teamSlug}/members/${userUid}/role/`, {
      json: { role: options.role },
    });
  }
}
