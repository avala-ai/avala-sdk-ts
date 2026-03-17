export interface AvalaConfig {
  apiKey?: string;
  baseUrl?: string;
  timeout?: number;
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
  s3AuthMethod: string | null;
  s3IsAccelerated: boolean;
  gcStorageBucketName: string | null;
  gcStoragePrefix: string | null;
  isVerified: boolean;
  lastVerifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface StorageConfigSetupInfo {
  avalaAwsAccountId: string;
  externalId: string;
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
  description: string | null;
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
  status: string | null;
  action: string | null;
  eventPayload: Record<string, unknown> | null;
  responsePayload: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface InferenceProvider {
  uid: string;
  name: string;
  description: string | null;
  providerType: string | null;
  config: Record<string, unknown> | null;
  isActive: boolean;
  project: string | null;
  lastTestAt: string | null;
  lastTestSuccess: boolean | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AutoLabelJob {
  uid: string;
  status: string | null;
  modelType: string | null;
  confidenceThreshold: number | null;
  labels: string[];
  dryRun: boolean;
  totalItems: number;
  processedItems: number;
  successfulItems: number;
  failedItems: number;
  skippedItems: number;
  progressPct: number | null;
  errorMessage: string | null;
  summary: Record<string, unknown> | null;
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
  severity: string | null;
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
  severity: string | null;
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
  scoreType: string | null;
  score: number;
  annotatorCount: number;
  details: Record<string, unknown> | null;
  createdAt: string | null;
}

export interface ConsensusSummary {
  meanScore: number;
  medianScore: number;
  minScore: number;
  maxScore: number;
  totalItems: number;
  itemsWithConsensus: number;
  scoreDistribution: Record<string, unknown> | null;
  byTaskName: unknown[] | null;
}

export interface ConsensusComputeResult {
  status: string;
  message: string;
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
  responseBody: string | null;
  attempts: number;
  nextRetryAt: string | null;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface Organization {
  uid: string;
  name: string;
  slug: string;
  handle: string | null;
  description: string | null;
  logo: string | null;
  website: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  visibility: string | null;
  plan: string | null;
  isVerified: boolean;
  isActive: boolean;
  memberCount: number | null;
  teamCount: number | null;
  datasetCount: number | null;
  projectCount: number | null;
  sliceCount: number | null;
  role: string | null;
  joinedAt: string | null;
  allowedDomains: string[] | null;
  slugEditsRemaining: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface OrganizationMember {
  userUid: string;
  username: string | null;
  email: string | null;
  fullName: string | null;
  picture: string | null;
  role: string | null;
  createdAt: string | null;
}

export interface Invitation {
  uid: string;
  organizationName: string | null;
  organizationSlug: string | null;
  invitedEmail: string;
  invitedByUsername: string | null;
  role: string | null;
  status: string | null;
  expiresAt: string | null;
  isExpired: boolean | null;
  acceptUrl: string | null;
  copyLink: string | null;
  createdAt: string | null;
}

export interface Team {
  uid: string;
  name: string;
  slug: string | null;
  description: string | null;
  color: string | null;
  organizationUid: string | null;
  organizationName: string | null;
  organizationSlug: string | null;
  memberCount: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TeamMember {
  userUid: string;
  username: string | null;
  email: string | null;
  fullName: string | null;
  picture: string | null;
  role: string | null;
  createdAt: string | null;
}

export interface Slice {
  uid: string;
  name: string;
  slug: string | null;
  ownerName: string | null;
  organization: Record<string, unknown> | null;
  visibility: string | null;
  status: string | null;
  itemCount: number | null;
  subSlices: Record<string, unknown>[] | null;
  sourceData: unknown | null;
  featuredSliceItemUrls: string[] | null;
}

export interface SliceItem {
  id: number | null;
  uid: string;
  key: string | null;
  dataset: string | null;
  url: string | null;
  gpuTextureUrl: string | null;
  thumbnails: string[] | null;
  videoThumbnail: string | null;
  metadata: Record<string, unknown> | null;
  exportSnippet: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
  cropData: Record<string, unknown> | null;
  relatedItems: Record<string, unknown>[] | null;
  relatedSequenceUid: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DatasetItem {
  id: number | null;
  uid: string;
  key: string | null;
  dataset: string | null;
  url: string | null;
  gpuTextureUrl: string | null;
  thumbnails: string[] | null;
  videoThumbnail: string | null;
  metadata: Record<string, unknown> | null;
  exportSnippet: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
  cropData: Record<string, unknown> | null;
  relatedItems: Record<string, unknown>[] | null;
  relatedSequenceUid: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DatasetSequence {
  uid: string;
  key: string | null;
  customUuid: string | null;
  status: string | null;
  featuredImage: string | null;
  numberOfFrames: number | null;
  views: Record<string, unknown>[] | null;
  cropData: Record<string, unknown> | null;
  predefinedLabels: Record<string, unknown>[] | null;
  frames: Record<string, unknown>[] | null;
  metrics: Record<string, unknown> | null;
  datasetUid: string | null;
  allowLidarCalibration: boolean | null;
  lidarCalibrationEnabled: boolean | null;
  cameraCalibrationEnabled: boolean | null;
}

// ── Annotation Issues ────────────────────────────────────────

export interface AnnotationIssueProject {
  uid: string;
  name: string;
}

export interface AnnotationIssueReporter {
  username: string;
  picture: string | null;
  fullName: string | null;
  type: string | null;
  isStaff: boolean | null;
}

export interface AnnotationIssueTool {
  uid: string;
  name: string;
  default: boolean | null;
}

export interface AnnotationIssueProblem {
  uid: string;
  title: string;
}

export interface AnnotationIssue {
  uid: string;
  datasetItemUid: string | null;
  sequenceUid: string | null;
  project: AnnotationIssueProject | null;
  reporter: AnnotationIssueReporter | null;
  priority: string | null;
  severity: string | null;
  description: string | null;
  status: string | null;
  tool: AnnotationIssueTool | null;
  problem: AnnotationIssueProblem | null;
  wrongClass: string | null;
  correctClass: string | null;
  shouldReAnnotate: boolean | null;
  shouldDelete: boolean | null;
  framesAffected: string | null;
  coordinates: unknown;
  queryParams: Record<string, unknown> | null;
  createdAt: string | null;
  closedAt: string | null;
  objectUid: string | null;
}

export interface AnnotationIssueMetrics {
  statusCount: Record<string, number> | null;
  priorityCount: Record<string, number> | null;
  severityCount: Record<string, number> | null;
  meanSecondsCloseTimeAll: number | null;
  meanSecondsCloseTimeCustomer: number | null;
  meanUnresolvedIssueAgeAll: number | null;
  meanUnresolvedIssueAgeCustomer: number | null;
  objectCountByAnnotationIssueProblemUid: Record<string, unknown>[] | null;
}

export interface AnnotationIssueToolDetail {
  uid: string;
  name: string;
  datasetType: string | null;
  default: boolean | null;
  problems: AnnotationIssueProblem[] | null;
}

// ── Fleet Management ────────────────────────────────────────

export interface FleetDevice {
  uid: string;
  name: string;
  type: string | null;
  status: string | null;
  tags: string[];
  firmwareVersion: string | null;
  metadata: Record<string, unknown> | null;
  lastSeenAt: string | null;
  deviceToken: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FleetRecording {
  uid: string;
  device: string | null;
  status: string | null;
  durationSeconds: number | null;
  sizeBytes: number | null;
  topicCount: number;
  tags: string[];
  topics: Array<Record<string, unknown>> | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FleetEvent {
  uid: string;
  recording: string | null;
  device: string | null;
  type: string | null;
  label: string | null;
  description: string | null;
  timestamp: string | null;
  durationMs: number | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  severity: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FleetRule {
  uid: string;
  name: string;
  description: string | null;
  enabled: boolean;
  condition: Record<string, unknown> | null;
  actions: Array<Record<string, unknown>>;
  scope: Record<string, unknown> | null;
  hitCount: number;
  lastHitAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FleetAlert {
  uid: string;
  rule: string | null;
  device: string | null;
  recording: string | null;
  severity: string | null;
  status: string | null;
  message: string | null;
  triggeredAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface FleetAlertChannel {
  uid: string;
  name: string;
  type: string | null;
  config: Record<string, unknown> | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// ── Signup ──────────────────────────────────────────────────

export interface SignupUser {
  uid: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  inWaitlist: boolean;
}

export interface SignupResponse {
  user: SignupUser;
  apiKey: string;
}

/** Raw API response shape from DRF cursor pagination */
export interface RawPageResponse {
  results: Record<string, unknown>[];
  next: string | null;
  previous: string | null;
}
