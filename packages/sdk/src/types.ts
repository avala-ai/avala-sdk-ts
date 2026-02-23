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

export interface Agent {
  uid: string;
  name: string;
  description: string;
  events: string[];
  callbackUrl: string | null;
  isActive: boolean;
  project: string | null;
  taskTypes: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AgentExecution {
  uid: string;
  registration: string;
  eventType: string;
  task: string | null;
  result: string | null;
  status: string;
  action: string | null;
  eventPayload: Record<string, unknown>;
  responsePayload: Record<string, unknown>;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface InferenceProvider {
  uid: string;
  name: string;
  description: string;
  providerType: string;
  config: Record<string, unknown>;
  isActive: boolean;
  project: string | null;
  lastTestAt: string | null;
  lastTestSuccess: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AutoLabelJob {
  uid: string;
  status: string;
  modelType: string;
  confidenceThreshold: number;
  labels: string[];
  dryRun: boolean;
  totalItems: number;
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  skippedItems: number;
  progressPct: number;
  errorMessage: string | null;
  summary: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
}

export interface QualityTarget {
  uid: string;
  name: string;
  metric: string;
  operator: string;
  threshold: number;
  severity: string;
  isActive: boolean;
  notifyWebhook: boolean;
  notifyEmails: string[];
  lastEvaluatedAt: string | null;
  lastValue: number | null;
  isBreached: boolean;
  breachCount: number;
  lastBreachedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface QualityTargetEvaluation {
  uid: string;
  name: string;
  metric: string;
  threshold: number;
  operator: string;
  currentValue: number;
  isBreached: boolean;
  severity: string;
}

export interface ConsensusConfig {
  uid: string;
  iouThreshold: number;
  minAgreementRatio: number;
  minAnnotations: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ConsensusScore {
  uid: string;
  datasetItemUid: string;
  taskName: string;
  scoreType: string;
  score: number;
  annotatorCount: number;
  details: Record<string, unknown>;
  createdAt: string | null;
}

export interface ConsensusSummary {
  meanScore: number;
  medianScore: number;
  minScore: number;
  maxScore: number;
  totalItems: number;
  itemsWithConsensus: number;
  scoreDistribution: Record<string, unknown>;
  byTaskName: unknown[];
}

export interface ConsensusComputeResult {
  computed: number;
  skipped: number;
  errorCount: number;
}

export interface Webhook {
  uid: string;
  targetUrl: string;
  events: string[];
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface WebhookDelivery {
  uid: string;
  subscription: string;
  eventType: string;
  payload: Record<string, unknown>;
  responseStatus: number | null;
  responseBody: string;
  attempts: number;
  nextRetryAt: string | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/** Raw API response shape from DRF cursor pagination */
export interface RawPageResponse {
  results: Record<string, unknown>[];
  next: string | null;
  previous: string | null;
}
