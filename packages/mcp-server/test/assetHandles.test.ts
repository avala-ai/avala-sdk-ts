import { describe, expect, it, vi } from "vitest";
import {
  assetIdentityForUrl,
  assetizeCredentialUrls,
  createAssetHandleService,
  isCredentialBearingUrl,
  registerAssetResolverTool as registerAssetResolverToolWithGrant,
  type AssetLocator,
} from "../src/assetHandles.js";
import { enforceEgressScrubbing } from "../src/egress.js";
import { findSecrets } from "../src/secrets.js";

type ToolHandler = (
  args: Record<string, unknown>,
  context?: unknown,
) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  resultType?: string;
  inputRequests?: Record<string, unknown>;
  requestState?: string;
  isError?: boolean;
}>;

function legacyConfirmedContext() {
  return {
    mcpReq: {
      envelope: undefined,
      inputResponses: undefined,
      requestState: () => undefined,
      elicitInput: vi.fn().mockResolvedValue({
        action: "accept",
        content: { confirm: true },
      }),
    },
  };
}

function modernContext(
  inputResponses?: Record<string, unknown>,
  requestState?: string,
) {
  return {
    mcpReq: {
      envelope: {},
      inputResponses,
      requestState: () => requestState,
      elicitInput: vi.fn(),
    },
  };
}

function createMockServer() {
  const handlers = new Map<string, ToolHandler>();
  const registrations = new Map<string, Record<string, unknown>>();
  return {
    registerTool: vi.fn(
      (name: string, config: Record<string, unknown>, handler: ToolHandler) => {
        registrations.set(name, config);
        handlers.set(name, handler);
      },
    ),
    getHandler(name: string) {
      return handlers.get(name);
    },
    getConfig(name: string) {
      return registrations.get(name);
    },
  };
}

const FULL_ASSET_GRANT = {
  scopes: new Set([
    "datasets.read",
    "organizations.read",
    "slices.read",
    "exports.read",
  ]),
  toolsets: new Set([
    "datasets",
    "sequences",
    "organizations",
    "slices",
    "exports",
  ]),
  isStaffPrivileged: false,
};

function registerAssetResolverTool(
  server: Parameters<typeof registerAssetResolverToolWithGrant>[0],
  getClient: Parameters<typeof registerAssetResolverToolWithGrant>[1],
  handles: Parameters<typeof registerAssetResolverToolWithGrant>[2],
): void {
  registerAssetResolverToolWithGrant(
    server,
    getClient,
    handles,
    FULL_ASSET_GRANT,
  );
}

const SIGNED_URL =
  "https://bucket.s3.amazonaws.com/export.zip" +
  "?X-Amz-Date=20260829T080000Z&X-Amz-Expires=3600" +
  "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260829%2Fus-west-2%2Fs3%2Faws4_request" +
  "&X-Amz-Signature=abcdef0123456789abcdef0123456789";
const REPLACEMENT_SIGNED_URL =
  "https://bucket.s3.amazonaws.com/replacement.zip" +
  "?X-Amz-Date=20260829T080000Z&X-Amz-Expires=3600" +
  "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260829%2Fus-west-2%2Fs3%2Faws4_request" +
  "&X-Amz-Signature=9876543210abcdef9876543210abcdef";

describe("opaque asset handles", () => {
  const locator: AssetLocator = {
    kind: "frame_asset",
    owner: "acme",
    slug: "warehouse",
    sequenceUid: "sequence-secret-uid",
    frameUid: "frame-secret-uid",
    identity: assetIdentityForUrl(SIGNED_URL),
    path: ["images", 0, "imageUrl"],
  };

  it("round-trips an encrypted locator without exposing resource identifiers", () => {
    const issuer = createAssetHandleService("stable-test-key", () => 1_000);
    const otherReplica = createAssetHandleService(
      "stable-test-key",
      () => 1_001,
    );
    const first = issuer.issue(locator);
    const second = issuer.issue(locator);

    expect(first.handle).toMatch(/^ah_[A-Za-z0-9_-]+$/);
    expect(first.handle).not.toContain("sequence-secret-uid");
    expect(first.handle).not.toBe(second.handle);
    expect(otherReplica.open(first.handle)).toEqual(locator);

    const confirmation = issuer.issueConfirmation(first.handle);
    expect(confirmation).toMatch(/^ac_[A-Za-z0-9_-]+$/);
    expect(confirmation).not.toContain(first.handle);
    expect(() =>
      otherReplica.verifyConfirmation(confirmation, first.handle),
    ).not.toThrow();
    expect(() =>
      otherReplica.verifyConfirmation(confirmation, second.handle),
    ).toThrow("Invalid or expired asset confirmation.");
  });

  it("recognizes AWS and GCS signed URLs without classifying public URLs", () => {
    const gcs =
      "https://storage.googleapis.com/bucket/object" +
      "?X-Goog-Credential=service-account%40example.iam.gserviceaccount.com%2F20260829%2Fauto%2Fstorage%2Fgoog4_request" +
      "&X-Goog-Signature=abcdef0123456789abcdef0123456789";

    expect(isCredentialBearingUrl(SIGNED_URL)).toBe(true);
    expect(isCredentialBearingUrl(gcs)).toBe(true);
    expect(isCredentialBearingUrl("https://cdn.example.com/public.jpg")).toBe(
      false,
    );
  });

  it("redacts sensitive URL fields instead of renaming them into handles", () => {
    const handles = createAssetHandleService("sensitive-field-key", () => 1_000);
    const locatorForPath = vi.fn(
      (path: readonly (string | number)[], url: string): AssetLocator => ({
        kind: "dataset_asset",
        uid: "dataset-1",
        identity: assetIdentityForUrl(url),
        path: [...path],
      }),
    );

    const result = assetizeCredentialUrls(
      {
        token: SIGNED_URL,
        tokenUrl: SIGNED_URL,
        credentials: { downloadUrl: SIGNED_URL },
        mediaUrl: SIGNED_URL,
      },
      locatorForPath,
      handles,
    ) as Record<string, unknown>;

    expect(result.token).toBe("[redacted]");
    expect(result.tokenUrl).toBe("[redacted]");
    expect(result.credentials).toBe("[redacted]");
    expect(result).not.toHaveProperty("tokenAsset");
    expect(locatorForPath).toHaveBeenCalledOnce();
    expect(locatorForPath).toHaveBeenCalledWith(["mediaUrl"], SIGNED_URL);
    expect(
      handles.open((result.mediaAsset as { handle: string }).handle),
    ).toMatchObject({ path: ["mediaUrl"] });
  });

  it("keeps query-selected asset identity while ignoring provider signatures", () => {
    const first =
      "https://bucket.s3.amazonaws.com/download?versionId=asset-a" +
      "&X-Amz-Date=20260829T080000Z&X-Amz-Expires=3600" +
      "&X-Amz-Credential=first-credential&X-Amz-Signature=first-signature";
    const refreshed =
      "https://bucket.s3.amazonaws.com/download?X-Amz-Signature=second-signature" +
      "&X-Amz-Credential=second-credential&X-Amz-Expires=900" +
      "&versionId=asset-a&X-Amz-Date=20260829T090000Z";
    const replacement = refreshed.replace(
      "versionId=asset-a",
      "versionId=asset-b",
    );

    expect(assetIdentityForUrl(first)).toBe(assetIdentityForUrl(refreshed));
    expect(assetIdentityForUrl(first)).not.toBe(
      assetIdentityForUrl(replacement),
    );
    expect(
      assetIdentityForUrl(
        "https://download.example.com/file?token=asset-identifier-aaaaaaaa",
      ),
    ).not.toBe(
      assetIdentityForUrl(
        "https://download.example.com/file?token=asset-identifier-bbbbbbbb",
      ),
    );
  });

  it("rejects tampering, the wrong key, and expired handles identically", () => {
    const issuer = createAssetHandleService("issuer-key", () => 1_000);
    const handle = issuer.issue(locator).handle;
    const tamperAt = Math.floor(handle.length / 2);
    const tampered = `${handle.slice(0, tamperAt)}${handle[tamperAt] === "A" ? "B" : "A"}${handle.slice(tamperAt + 1)}`;
    const wrongKey = createAssetHandleService("different-key", () => 1_001);
    const expired = createAssetHandleService(
      "issuer-key",
      () => 1_000 + 15 * 60 * 1000,
    );

    for (const attempt of [
      () => issuer.open(tampered),
      () => wrongKey.open(handle),
      () => expired.open(handle),
    ]) {
      expect(attempt).toThrow("Invalid or expired asset handle.");
    }

    const confirmation = issuer.issueConfirmation(handle);
    const confirmationTamperAt = Math.floor(confirmation.length / 2);
    const tamperedConfirmation = `${confirmation.slice(0, confirmationTamperAt)}${confirmation[confirmationTamperAt] === "A" ? "B" : "A"}${confirmation.slice(confirmationTamperAt + 1)}`;
    const expiredConfirmation = createAssetHandleService(
      "issuer-key",
      () => 1_000 + 5 * 60 * 1000,
    );
    for (const attempt of [
      () => issuer.verifyConfirmation(tamperedConfirmation, handle),
      () => wrongKey.verifyConfirmation(confirmation, handle),
      () => expiredConfirmation.verifyConfirmation(confirmation, handle),
    ]) {
      expect(attempt).toThrow("Invalid or expired asset confirmation.");
    }
  });

  it("re-fetches the resource with the current credential before releasing a URL", async () => {
    const handles = createAssetHandleService("resolver-test-key", () => 1_000);
    const server = createMockServer();
    const transport = {
      requestSingle: vi.fn().mockResolvedValue({ downloadUrl: SIGNED_URL }),
    };
    const getClient = vi.fn(() => ({
      transport,
      datasets: { getFrame: vi.fn() },
    }));
    registerAssetResolverTool(
      enforceEgressScrubbing(server as never),
      getClient as never,
      handles,
    );
    const reference = handles.issue({
      kind: "export_download",
      uid: "export-1",
      identity: assetIdentityForUrl(SIGNED_URL),
    });

    const handler = server.getHandler("resolve_asset_handle")!;
    const pending = await handler(
      { handle: reference.handle },
      modernContext(),
    );
    expect(pending.resultType).toBe("input_required");
    expect(pending.requestState).toMatch(/^ac_/);
    expect(transport.requestSingle).not.toHaveBeenCalled();
    if (!pending.requestState) throw new Error("Missing confirmation state.");

    const result = await handler(
      { handle: reference.handle },
      modernContext(
        {
          confirmAssetUrlRelease: {
            action: "accept",
            content: { confirm: true },
          },
        },
        pending.requestState,
      ),
    );

    expect(getClient).toHaveBeenCalledWith("resolve_asset_handle");
    expect(transport.requestSingle).toHaveBeenCalledWith("/exports/export-1/");
    expect(result.structuredContent).toEqual({
      url: SIGNED_URL,
      expiresAt: "2026-08-29T09:00:00.000Z",
    });
    expect(result.content[0]!.text).toContain("X-Amz-Signature");
    expect(findSecrets(result).length).toBeGreaterThan(0);
  });

  it("requires the locator's domain scope before requesting confirmation", async () => {
    const handles = createAssetHandleService("scope-gate-key", () => 1_000);
    const server = createMockServer();
    const requestSingle = vi.fn().mockResolvedValue({ downloadUrl: SIGNED_URL });
    registerAssetResolverToolWithGrant(
      server as never,
      (() => ({ transport: { requestSingle } })) as never,
      handles,
      {
        scopes: new Set(["organizations.read"]),
        toolsets: new Set(["organizations"]),
        isStaffPrivileged: false,
      },
    );
    const reference = handles.issue({
      kind: "export_download",
      uid: "export-scope-revoked",
      identity: assetIdentityForUrl(SIGNED_URL),
    });
    const context = legacyConfirmedContext();

    await expect(
      server.getHandler("resolve_asset_handle")!(
        { handle: reference.handle },
        context,
      ),
    ).rejects.toThrow(
      "Asset handle is not authorized for the current credential.",
    );
    expect(context.mcpReq.elicitInput).not.toHaveBeenCalled();
    expect(requestSingle).not.toHaveBeenCalled();
  });

  it("re-checks stdio scope after confirmation before the resource fetch", async () => {
    const handles = createAssetHandleService("scope-recheck-key", () => 1_000);
    const server = createMockServer();
    const requestSingle = vi.fn().mockResolvedValue({ downloadUrl: SIGNED_URL });
    const getPermissions = vi
      .fn()
      .mockResolvedValueOnce({ scopes: ["exports.read"] })
      .mockResolvedValueOnce({ scopes: ["organizations.read"] });
    const getClient = vi.fn((clientName: string) =>
      clientName === "resolve_asset_handle_permissions"
        ? { permissions: { get: getPermissions } }
        : { transport: { requestSingle } },
    );
    registerAssetResolverToolWithGrant(
      server as never,
      getClient as never,
      handles,
    );
    const reference = handles.issue({
      kind: "export_download",
      uid: "export-revoked-during-confirmation",
      identity: assetIdentityForUrl(SIGNED_URL),
    });
    const context = legacyConfirmedContext();

    await expect(
      server.getHandler("resolve_asset_handle")!(
        { handle: reference.handle },
        context,
      ),
    ).rejects.toThrow(
      "Asset handle is not authorized for the current credential.",
    );
    expect(context.mcpReq.elicitInput).toHaveBeenCalledOnce();
    expect(getPermissions).toHaveBeenCalledTimes(2);
    expect(requestSingle).not.toHaveBeenCalled();
  });

  it("cannot bypass or replay confirmation across handles", async () => {
    const handles = createAssetHandleService("confirmation-gate-key", () => 1_000);
    const server = createMockServer();
    const requestSingle = vi.fn().mockResolvedValue({ downloadUrl: SIGNED_URL });
    registerAssetResolverTool(
      server as never,
      (() => ({
        transport: { requestSingle },
        datasets: { getFrame: vi.fn() },
      })) as never,
      handles,
    );
    const first = handles.issue({
      kind: "export_download",
      uid: "export-1",
      identity: assetIdentityForUrl(SIGNED_URL),
    });
    const second = handles.issue({
      kind: "export_download",
      uid: "export-2",
      identity: assetIdentityForUrl(SIGNED_URL),
    });
    const acceptedResponse = {
      confirmAssetUrlRelease: {
        action: "accept",
        content: { confirm: true },
      },
    };
    const handler = server.getHandler("resolve_asset_handle")!;

    await expect(
      handler(
        { handle: first.handle },
        modernContext(acceptedResponse),
      ),
    ).rejects.toThrow("Invalid or expired asset confirmation.");

    const pending = await handler(
      { handle: first.handle },
      modernContext(),
    );
    if (!pending.requestState) throw new Error("Missing confirmation state.");
    await expect(
      handler(
        { handle: second.handle },
        modernContext(acceptedResponse, pending.requestState),
      ),
    ).rejects.toThrow("Invalid or expired asset confirmation.");

    const declined = await handler(
      { handle: first.handle },
      modernContext({
        confirmAssetUrlRelease: { action: "decline" },
      }),
    );
    expect(declined.isError).toBe(true);
    expect(requestSingle).not.toHaveBeenCalled();
  });

  it("resolves every resource-backed locator from its current REST shape", async () => {
    const handles = createAssetHandleService("locator-matrix-key", () => 1_000);
    const server = createMockServer();
    const responses = new Map<string, unknown>([
      [
        "/slices/acme/interesting/",
        { featuredSliceItemUrls: ["https://cdn.example/public.jpg", SIGNED_URL] },
      ],
      [
        "/datasets/dataset-1/",
        {
          logo: SIGNED_URL,
          featuredItemsUrl: ["https://cdn.example/public.jpg", SIGNED_URL],
        },
      ],
      ["/organizations/acme/", { logo: SIGNED_URL }],
      [
        "/datasets/acme/warehouse/sequences/sequence-1/",
        {
          previewUrl: SIGNED_URL,
          frames: [
            {
              uid: "earlier-frame",
              images: [{ imageUrl: "https://cdn.example/earlier.jpg" }],
            },
            {
              uid: "frame-7",
              images: [
                { imageUrl: "https://cdn.example/earlier-camera.jpg" },
                { imageUrl: SIGNED_URL },
              ],
            },
          ],
        },
      ],
      [
        "/results/result-1/capture-submission/",
        { thumbnailUrl: SIGNED_URL },
      ],
    ]);
    const requestSingle = vi.fn(async (path: string) => responses.get(path));
    const requestPage = vi.fn().mockResolvedValue({
      items: [
        {
          uid: "sequence-featured",
          featuredImage: SIGNED_URL,
        },
      ],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });
    const getFrame = vi.fn(async (
      _owner: string,
      _slug: string,
      _sequenceUid: string,
      frameIdx: number,
    ) => {
      const sequence = responses.get(
        "/datasets/acme/warehouse/sequences/sequence-1/",
      ) as { frames?: Record<string, unknown>[] } | undefined;
      const raw = sequence?.frames?.[frameIdx];
      return {
        images: raw?.images,
        raw,
      };
    });
    registerAssetResolverTool(
      server as never,
      (() => ({
        transport: { requestSingle, requestPage },
        datasets: { getFrame },
      })) as never,
      handles,
    );

    const cases: { locator: AssetLocator; route?: string }[] = [
      {
        locator: {
          kind: "slice_featured_asset",
          owner: "acme",
          slug: "interesting",
          identity: assetIdentityForUrl(SIGNED_URL),
        },
        route: "/slices/acme/interesting/",
      },
      {
        locator: {
          kind: "dataset_asset",
          uid: "dataset-1",
          identity: assetIdentityForUrl(SIGNED_URL),
          path: ["logo"],
        },
        route: "/datasets/dataset-1/",
      },
      {
        locator: {
          kind: "dataset_featured_asset",
          uid: "dataset-1",
          identity: assetIdentityForUrl(SIGNED_URL),
        },
        route: "/datasets/dataset-1/",
      },
      {
        locator: {
          kind: "organization_asset",
          slug: "acme",
          identity: assetIdentityForUrl(SIGNED_URL),
          path: ["logo"],
        },
        route: "/organizations/acme/",
      },
      {
        locator: {
          kind: "sequence_asset",
          owner: "acme",
          slug: "warehouse",
          sequenceUid: "sequence-1",
          identity: assetIdentityForUrl(SIGNED_URL),
          path: ["previewUrl"],
        },
        route: "/datasets/acme/warehouse/sequences/sequence-1/",
      },
      {
        locator: {
          kind: "sequence_frame_asset",
          owner: "acme",
          slug: "warehouse",
          sequenceUid: "sequence-1",
          frameUid: "frame-7",
          identity: assetIdentityForUrl(SIGNED_URL),
          path: ["images", 1, "imageUrl"],
        },
        route: "/datasets/acme/warehouse/sequences/sequence-1/",
      },
      {
        locator: {
          kind: "sequence_featured_asset",
          owner: "acme",
          slug: "warehouse",
          sequenceUid: "sequence-featured",
          limit: 5,
          cursor: "page-2",
          identity: assetIdentityForUrl(SIGNED_URL),
        },
      },
      {
        locator: {
          kind: "capture_asset",
          resultUid: "result-1",
          identity: assetIdentityForUrl(SIGNED_URL),
          path: ["thumbnailUrl"],
        },
        route: "/results/result-1/capture-submission/",
      },
      {
        locator: {
          kind: "frame_asset",
          owner: "acme",
          slug: "warehouse",
          sequenceUid: "sequence-1",
          frameUid: "frame-7",
          identity: assetIdentityForUrl(SIGNED_URL),
          path: ["images", 1, "imageUrl"],
        },
        route: "/datasets/acme/warehouse/sequences/sequence-1/",
      },
    ];

    for (const { locator: currentLocator, route } of cases) {
      const reference = handles.issue(currentLocator);
      const result = await server.getHandler("resolve_asset_handle")!(
        { handle: reference.handle },
        legacyConfirmedContext(),
      );
      expect(result.structuredContent?.url).toBe(SIGNED_URL);
      if (route) expect(requestSingle).toHaveBeenCalledWith(route);
    }
    expect(getFrame).toHaveBeenCalledWith(
      "acme",
      "warehouse",
      "sequence-1",
      1,
    );
    expect(requestPage).toHaveBeenCalledWith(
      "/datasets/acme/warehouse/sequences/",
      { limit: "5", cursor: "page-2" },
    );

    // Removing the selected featured item must fail closed instead of
    // returning whichever URL moved into its old array position.
    responses.set("/slices/acme/interesting/", {
      featuredSliceItemUrls: ["https://cdn.example/public.jpg"],
    });
    responses.set("/datasets/dataset-1/", {
      logo: SIGNED_URL,
      featuredItemsUrl: ["https://cdn.example/public.jpg"],
    });
    for (const staleLocator of [
      {
        kind: "slice_featured_asset" as const,
        owner: "acme",
        slug: "interesting",
        identity: assetIdentityForUrl(SIGNED_URL),
      },
      {
        kind: "dataset_featured_asset" as const,
        uid: "dataset-1",
        identity: assetIdentityForUrl(SIGNED_URL),
      },
    ]) {
      const stale = handles.issue(staleLocator);
      await expect(
        server.getHandler("resolve_asset_handle")!(
          { handle: stale.handle },
          legacyConfirmedContext(),
        ),
      ).rejects.toThrow("The asset is no longer available.");
    }

    const frameLocators: AssetLocator[] = [
      {
        kind: "sequence_frame_asset",
        owner: "acme",
        slug: "warehouse",
        sequenceUid: "sequence-1",
        frameUid: "frame-7",
        identity: assetIdentityForUrl(SIGNED_URL),
        path: ["images", 1, "imageUrl"],
      },
      {
        kind: "frame_asset",
        owner: "acme",
        slug: "warehouse",
        sequenceUid: "sequence-1",
        frameUid: "frame-7",
        identity: assetIdentityForUrl(SIGNED_URL),
        path: ["images", 1, "imageUrl"],
      },
    ];
    // If an earlier frame disappears, locate the selected frame by UID and
    // resolve its new position instead of following the old array index.
    responses.set("/datasets/acme/warehouse/sequences/sequence-1/", {
      frames: [
        {
          uid: "frame-7",
          images: [{ imageUrl: SIGNED_URL }],
        },
      ],
    });
    for (const shiftedLocator of frameLocators) {
      const shifted = handles.issue(shiftedLocator);
      const result = await server.getHandler("resolve_asset_handle")!(
        { handle: shifted.handle },
        legacyConfirmedContext(),
      );
      expect(result.structuredContent?.url).toBe(SIGNED_URL);
    }
    expect(getFrame).toHaveBeenLastCalledWith(
      "acme",
      "warehouse",
      "sequence-1",
      0,
    );

    // Removing the selected nested URL must fail closed instead of returning
    // whichever camera URL moved into its former position.
    responses.set("/datasets/acme/warehouse/sequences/sequence-1/", {
      frames: [
        {
          uid: "frame-7",
          images: [{ imageUrl: "https://cdn.example/successor-camera.jpg" }],
        },
      ],
    });
    for (const staleLocator of frameLocators) {
      const stale = handles.issue(staleLocator);
      await expect(
        server.getHandler("resolve_asset_handle")!(
          { handle: stale.handle },
          legacyConfirmedContext(),
        ),
      ).rejects.toThrow("The asset is no longer available.");
    }

    // Removing the selected frame itself must fail closed too.
    responses.set("/datasets/acme/warehouse/sequences/sequence-1/", {
      frames: [
        {
          uid: "successor-frame",
          images: [{ imageUrl: SIGNED_URL }],
        },
      ],
    });
    for (const staleLocator of frameLocators) {
      const stale = handles.issue(staleLocator);
      await expect(
        server.getHandler("resolve_asset_handle")!(
          { handle: stale.handle },
          legacyConfirmedContext(),
        ),
      ).rejects.toThrow("The asset is no longer available.");
    }
  });

  it("rejects replacement assets across every direct locator", async () => {
    const handles = createAssetHandleService("replacement-identity-key", () => 1_000);
    const server = createMockServer();
    const requestSingle = vi.fn(async (path: string) => {
      if (path === "/exports/export-1/") {
        return { downloadUrl: REPLACEMENT_SIGNED_URL };
      }
      if (path === "/datasets/dataset-1/") {
        return { logo: REPLACEMENT_SIGNED_URL };
      }
      if (path === "/organizations/acme/") {
        return { logo: REPLACEMENT_SIGNED_URL };
      }
      if (path === "/datasets/acme/warehouse/sequences/sequence-1/") {
        return { previewUrl: REPLACEMENT_SIGNED_URL };
      }
      if (path === "/results/result-1/capture-submission/") {
        return { thumbnailUrl: REPLACEMENT_SIGNED_URL };
      }
      throw new Error(`Unexpected route: ${path}`);
    });
    const requestPage = vi.fn().mockResolvedValue({
      items: [
        {
          uid: "sequence-1",
          featuredImage: REPLACEMENT_SIGNED_URL,
        },
      ],
      nextCursor: null,
      previousCursor: null,
      hasMore: false,
    });
    registerAssetResolverTool(
      server as never,
      (() => ({
        transport: { requestSingle, requestPage },
        datasets: { getFrame: vi.fn() },
      })) as never,
      handles,
    );

    const originalIdentity = assetIdentityForUrl(SIGNED_URL);
    const locators: AssetLocator[] = [
      {
        kind: "export_download",
        uid: "export-1",
        identity: originalIdentity,
      },
      {
        kind: "dataset_asset",
        uid: "dataset-1",
        identity: originalIdentity,
        path: ["logo"],
      },
      {
        kind: "organization_asset",
        slug: "acme",
        identity: originalIdentity,
        path: ["logo"],
      },
      {
        kind: "sequence_asset",
        owner: "acme",
        slug: "warehouse",
        sequenceUid: "sequence-1",
        identity: originalIdentity,
        path: ["previewUrl"],
      },
      {
        kind: "sequence_featured_asset",
        owner: "acme",
        slug: "warehouse",
        sequenceUid: "sequence-1",
        limit: 5,
        identity: originalIdentity,
      },
      {
        kind: "capture_asset",
        resultUid: "result-1",
        identity: originalIdentity,
        path: ["thumbnailUrl"],
      },
    ];

    for (const current of locators) {
      const reference = handles.issue(current);
      await expect(
        server.getHandler("resolve_asset_handle")!(
          { handle: reference.handle },
          legacyConfirmedContext(),
        ),
      ).rejects.toThrow("The asset is no longer available.");
    }
  });

  it("rejects a query-selected replacement that shares the same path", async () => {
    const handles = createAssetHandleService("query-identity-key", () => 1_000);
    const server = createMockServer();
    const original =
      "https://download.example.com/file?token=asset-identifier-aaaaaaaa";
    const replacement =
      "https://download.example.com/file?token=asset-identifier-bbbbbbbb";
    registerAssetResolverTool(
      server as never,
      (() => ({
        transport: {
          requestSingle: vi.fn().mockResolvedValue({
            downloadUrl: replacement,
          }),
        },
      })) as never,
      handles,
    );
    const reference = handles.issue({
      kind: "export_download",
      uid: "export-query-selected",
      identity: assetIdentityForUrl(original),
    });

    await expect(
      server.getHandler("resolve_asset_handle")!(
        { handle: reference.handle },
        legacyConfirmedContext(),
      ),
    ).rejects.toThrow("The asset is no longer available.");
  });

  it("reports legacy provider expiry when it is encoded as epoch seconds", async () => {
    const handles = createAssetHandleService("legacy-expiry-key", () => 1_000);
    const server = createMockServer();
    const url =
      "https://bucket.s3.amazonaws.com/export.zip" +
      "?AWSAccessKeyId=AKIAIOSFODNN7EXAMPLE" +
      "&Signature=abcdef0123456789&Expires=1787994000";
    registerAssetResolverTool(
      server as never,
      (() => ({
        transport: {
          requestSingle: vi.fn().mockResolvedValue({ downloadUrl: url }),
        },
        datasets: { getFrame: vi.fn() },
      })) as never,
      handles,
    );

    const reference = handles.issue({
      kind: "export_download",
      uid: "export-legacy",
      identity: assetIdentityForUrl(url),
    });
    const result = await server.getHandler("resolve_asset_handle")!(
      { handle: reference.handle },
      legacyConfirmedContext(),
    );

    expect(result.structuredContent?.expiresAt).toBe(
      "2026-08-29T09:00:00.000Z",
    );
  });

  it("reports no expiry when the provider URL does not declare one", async () => {
    const handles = createAssetHandleService("no-expiry-key", () => 1_000);
    const server = createMockServer();
    registerAssetResolverTool(
      server as never,
      (() => ({
        transport: {
          requestSingle: vi.fn().mockResolvedValue({
            downloadUrl: "https://cdn.example.com/export.zip",
          }),
        },
        datasets: { getFrame: vi.fn() },
      })) as never,
      handles,
    );

    const reference = handles.issue({
      kind: "export_download",
      uid: "export-public",
      identity: assetIdentityForUrl("https://cdn.example.com/export.zip"),
    });
    const result = await server.getHandler("resolve_asset_handle")!(
      { handle: reference.handle },
      legacyConfirmedContext(),
    );

    expect(result.structuredContent?.expiresAt).toBeNull();
  });

  it("does not retain a stale URL when the current credential can no longer read the resource", async () => {
    const handles = createAssetHandleService("resolver-test-key", () => 1_000);
    const server = createMockServer();
    const denied = new Error("AvalaError (HTTP 403)");
    const requestSingle = vi.fn().mockRejectedValue(denied);
    registerAssetResolverTool(
      server as never,
      (() => ({
        transport: { requestSingle },
        datasets: { getFrame: vi.fn() },
      })) as never,
      handles,
    );
    const reference = handles.issue({
      kind: "export_download",
      uid: "export-1",
      identity: assetIdentityForUrl(SIGNED_URL),
    });

    await expect(
      server.getHandler("resolve_asset_handle")!(
        { handle: reference.handle },
        legacyConfirmedContext(),
      ),
    ).rejects.toBe(denied);
    expect(requestSingle).toHaveBeenCalledTimes(1);
  });

  it("advertises confirmation metadata without claiming resolution is idempotent", () => {
    const server = createMockServer();
    registerAssetResolverTool(
      server as never,
      (() => ({})) as never,
      createAssetHandleService("metadata-test-key"),
    );

    const config = server.getConfig("resolve_asset_handle")!;
    expect(config.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
    expect(config._meta).toMatchObject({
      "avala.ai/requires-confirmation": true,
      "avala.ai/required-any-scopes": [
        "datasets.read",
        "organizations.read",
        "slices.read",
        "exports.read",
      ],
    });
  });
});
