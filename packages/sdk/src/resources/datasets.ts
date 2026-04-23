import type {
  CameraCalibration,
  CursorPage,
  Dataset,
  DatasetCalibration,
  DatasetFrame,
  DatasetHealth,
  DatasetItem,
  DatasetSequence,
  FrameImage,
  Quat,
  Vec3,
} from "../types.js";
import { BaseResource } from "./base.js";

function buildFrame(frames: Record<string, unknown>[], frameIdx: number, sequenceUid: string): DatasetFrame {
  if (frameIdx < 0 || frameIdx >= frames.length) {
    throw new RangeError(
      `frameIdx ${frameIdx} out of range for sequence ${sequenceUid} with ${frames.length} frames`,
    );
  }
  const raw = frames[frameIdx];
  const imagesRaw = (raw.images as Record<string, unknown>[] | undefined) ?? [];
  const images: FrameImage[] = imagesRaw.map((img) => ({
    imageUrl: (img.imageUrl as string | null | undefined) ?? null,
    position: (img.position as Vec3 | null | undefined) ?? null,
    heading: (img.heading as Quat | null | undefined) ?? null,
    width: (img.width as number | null | undefined) ?? null,
    height: (img.height as number | null | undefined) ?? null,
    fx: (img.fx as number | null | undefined) ?? null,
    fy: (img.fy as number | null | undefined) ?? null,
    cx: (img.cx as number | null | undefined) ?? null,
    cy: (img.cy as number | null | undefined) ?? null,
    model: (img.model as string | null | undefined) ?? (img.cameraModel as string | null | undefined) ?? null,
    cameraModel: (img.cameraModel as string | null | undefined) ?? (img.model as string | null | undefined) ?? null,
    xi: (img.xi as number | null | undefined) ?? null,
    alpha: (img.alpha as number | null | undefined) ?? null,
  }));
  return {
    frameIndex: frameIdx,
    key: (raw.key as string | null | undefined) ?? null,
    model: (raw.model as string | null | undefined) ?? (raw.cameraModel as string | null | undefined) ?? null,
    cameraModel: (raw.cameraModel as string | null | undefined) ?? (raw.model as string | null | undefined) ?? null,
    xi: (raw.xi as number | null | undefined) ?? null,
    alpha: (raw.alpha as number | null | undefined) ?? null,
    devicePosition: (raw.devicePosition as Vec3 | null | undefined) ?? null,
    deviceHeading: (raw.deviceHeading as Quat | null | undefined) ?? null,
    images,
    raw,
  };
}

function buildCalibrationFromSequence(sequence: DatasetSequence): DatasetCalibration {
  const frames = sequence.frames ?? [];
  if (frames.length === 0) {
    return { sequenceUid: sequence.uid, cameras: [] };
  }
  const frame0 = frames[0];
  const images = (frame0.images as Record<string, unknown>[] | undefined) ?? [];
  const model0 = (frame0.model as string | null | undefined) ?? null;
  const xi0 = (frame0.xi as number | null | undefined) ?? null;
  const alpha0 = (frame0.alpha as number | null | undefined) ?? null;
  const cameras: CameraCalibration[] = images.map((img) => ({
    cameraId:
      (img.camera as string | null | undefined) ??
      (img.cameraId as string | null | undefined) ??
      (img.sensorId as string | null | undefined) ??
      null,
    position: (img.position as Vec3 | null | undefined) ?? null,
    heading: (img.heading as Quat | null | undefined) ?? null,
    width: (img.width as number | null | undefined) ?? null,
    height: (img.height as number | null | undefined) ?? null,
    fx: (img.fx as number | null | undefined) ?? null,
    fy: (img.fy as number | null | undefined) ?? null,
    cx: (img.cx as number | null | undefined) ?? null,
    cy: (img.cy as number | null | undefined) ?? null,
    model: (img.model as string | null | undefined) ?? (img.cameraModel as string | null | undefined) ?? model0,
    xi: (img.xi as number | null | undefined) ?? xi0,
    alpha: (img.alpha as number | null | undefined) ?? alpha0,
  }));
  return { sequenceUid: sequence.uid, cameras };
}

export interface CreateDatasetOptions {
  name: string;
  slug: string;
  dataType: string;
  isSequence?: boolean;
  visibility?: string;
  createMetadata?: boolean;
  providerConfig?: Record<string, unknown>;
  ownerName?: string;
}

export class DatasetsResource extends BaseResource {
  async create(options: CreateDatasetOptions): Promise<Dataset> {
    const payload: Record<string, unknown> = {
      name: options.name,
      slug: options.slug,
      data_type: options.dataType,
    };
    if (options.isSequence !== undefined) payload.is_sequence = options.isSequence;
    if (options.visibility !== undefined) payload.visibility = options.visibility;
    if (options.createMetadata !== undefined) payload.create_metadata = options.createMetadata;
    if (options.providerConfig !== undefined) payload.provider_config = options.providerConfig;
    if (options.ownerName !== undefined) payload.owner_name = options.ownerName;
    return this.http.requestCreate<Dataset>("/datasets/", payload);
  }

  async list(options?: {
    dataType?: string;
    name?: string;
    status?: string;
    visibility?: string;
    limit?: number;
    cursor?: string;
  }): Promise<CursorPage<Dataset>> {
    const params: Record<string, string> = {};
    if (options?.dataType !== undefined) params.data_type = options.dataType;
    if (options?.name !== undefined) params.name = options.name;
    if (options?.status !== undefined) params.status = options.status;
    if (options?.visibility !== undefined) params.visibility = options.visibility;
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor !== undefined) params.cursor = options.cursor;
    return this.http.requestPage<Dataset>("/datasets/", Object.keys(params).length > 0 ? params : undefined);
  }

  async get(uid: string): Promise<Dataset> {
    return this.http.requestSingle<Dataset>(`/datasets/${uid}/`);
  }

  async listItems(
    owner: string,
    slug: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<CursorPage<DatasetItem>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor !== undefined) params.cursor = options.cursor;
    return this.http.requestPage<DatasetItem>(
      `/datasets/${owner}/${slug}/items/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async getItem(owner: string, slug: string, itemUid: string): Promise<DatasetItem> {
    return this.http.requestSingle<DatasetItem>(`/datasets/${owner}/${slug}/items/${itemUid}/`);
  }

  async listSequences(
    owner: string,
    slug: string,
    options?: { limit?: number; cursor?: string },
  ): Promise<CursorPage<DatasetSequence>> {
    const params: Record<string, string> = {};
    if (options?.limit !== undefined) params.limit = String(options.limit);
    if (options?.cursor !== undefined) params.cursor = options.cursor;
    return this.http.requestPage<DatasetSequence>(
      `/datasets/${owner}/${slug}/sequences/`,
      Object.keys(params).length > 0 ? params : undefined,
    );
  }

  async getSequence(owner: string, slug: string, sequenceUid: string): Promise<DatasetSequence> {
    return this.http.requestSingle<DatasetSequence>(`/datasets/${owner}/${slug}/sequences/${sequenceUid}/`);
  }

  /**
   * Return a single frame's LiDAR JSON metadata.
   *
   * Indexes into `getSequence().frames` client-side — the server embeds the
   * full frame array on the sequence response, so no extra round-trip is
   * needed beyond the sequence fetch.
   */
  async getFrame(owner: string, slug: string, sequenceUid: string, frameIdx: number): Promise<DatasetFrame> {
    const sequence = await this.getSequence(owner, slug, sequenceUid);
    return buildFrame(sequence.frames ?? [], frameIdx, sequenceUid);
  }

  /** Return a canonicalized rig view for a sequence, derived from frame[0]. */
  async getCalibration(owner: string, slug: string, sequenceUid: string): Promise<DatasetCalibration> {
    const sequence = await this.getSequence(owner, slug, sequenceUid);
    return buildCalibrationFromSequence(sequence);
  }

  /**
   * Return a read-only health snapshot for the dataset.
   *
   * Calls `GET /datasets/<owner>/<slug>/health/` — intended for post-ingest
   * validation (frame counts, indexing status, per-sequence calibration
   * presence, S3 prefix, any issues detected).
   */
  async getHealth(owner: string, slug: string): Promise<DatasetHealth> {
    return this.http.requestSingle<DatasetHealth>(`/datasets/${owner}/${slug}/health/`);
  }
}
