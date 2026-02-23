export interface AvalaConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface Dataset {
  uid: string;
  name: string;
  slug: string;
  itemCount: number;
  dataType: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Project {
  uid: string;
  name: string;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Export {
  uid: string;
  status: string | null;
  downloadUrl: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Task {
  uid: string;
  type: string | null;
  name: string | null;
  status: string | null;
  project: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StorageConfig {
  uid: string;
  name: string;
  provider: string;
  s3BucketName: string | null;
  s3BucketRegion: string | null;
  s3BucketPrefix: string | null;
  s3IsAccelerated: boolean;
  gcStorageBucketName: string | null;
  gcStoragePrefix: string | null;
  isVerified: boolean;
  lastVerifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface RateLimitInfo {
  limit: string | null;
  remaining: string | null;
  reset: string | null;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  previousCursor: string | null;
  hasMore: boolean;
}

/** Raw API response shape from DRF cursor pagination */
export interface RawPageResponse {
  results: Record<string, unknown>[];
  next: string | null;
  previous: string | null;
}
