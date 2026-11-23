import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const platformRoleEnum = pgEnum("platform_role", ["user", "super_admin"]);
export const organizationRoleEnum = pgEnum("organization_role", ["owner", "admin", "seo_manager", "editor", "viewer"]);
export const crawlStatusEnum = pgEnum("crawl_status", ["queued", "running", "completed", "failed", "cancelled"]);
export const issueSeverityEnum = pgEnum("issue_severity", ["critical", "high", "medium", "low", "info"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", ["trialing", "active", "past_due", "cancelled", "incomplete"]);

// Better Auth tables. Keep their model fields aligned with the adapter schema.
export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  platformRole: platformRoleEnum("platform_role").notNull().default("user"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const sessions = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" })
}, (table) => [index("session_user_id_idx").on(table.userId)]);

export const accounts = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true, mode: "date" }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true, mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [index("account_user_id_idx").on(table.userId), uniqueIndex("account_provider_account_uq").on(table.providerId, table.accountId)]);

export const verifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);

export const organizations = pgTable("organizations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const organizationMembers = pgTable("organization_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: organizationRoleEnum("role").notNull().default("viewer"),
  createdAt: createdAt()
}, (table) => [
  uniqueIndex("organization_member_uq").on(table.organizationId, table.userId),
  index("organization_members_user_idx").on(table.userId)
]);

export const organizationInvitations = pgTable("organization_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: organizationRoleEnum("role").notNull().default("viewer"),
  tokenHash: text("token_hash").notNull().unique(),
  invitedBy: text("invited_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt()
}, (table) => [index("organization_invitations_org_idx").on(table.organizationId, table.email)]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  websiteUrl: text("website_url").notNull(),
  normalizedHost: text("normalized_host").notNull(),
  targetCountry: text("target_country"),
  targetLanguage: text("target_language"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  crawlPageLimit: integer("crawl_page_limit").notNull().default(100),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [index("projects_org_idx").on(table.organizationId), uniqueIndex("project_org_host_uq").on(table.organizationId, table.normalizedHost)]);

export const projectIntegrations = pgTable("project_integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  accountLabel: text("account_label"),
  externalPropertyId: text("external_property_id"),
  credentialsCiphertext: text("credentials_ciphertext"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  connectedAt: timestamp("connected_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [uniqueIndex("project_integration_provider_uq").on(table.projectId, table.provider)]);

export const crawlJobs = pgTable("crawl_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  requestedBy: text("requested_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  status: crawlStatusEnum("status").notNull().default("queued"),
  queueJobId: text("queue_job_id"),
  pageLimit: integer("page_limit").notNull(),
  pagesDiscovered: integer("pages_discovered").notNull().default(0),
  pagesProcessed: integer("pages_processed").notNull().default(0),
  currentUrl: text("current_url"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  createdAt: createdAt()
}, (table) => [index("crawl_jobs_project_created_idx").on(table.projectId, table.createdAt), index("crawl_jobs_status_idx").on(table.status)]);

export const crawledPages = pgTable("crawled_pages", {
  id: uuid("id").defaultRandom().primaryKey(),
  crawlId: uuid("crawl_id").notNull().references(() => crawlJobs.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  finalUrl: text("final_url").notNull(),
  depth: integer("depth").notNull().default(0),
  statusCode: integer("status_code"),
  contentType: text("content_type"),
  htmlBytes: integer("html_bytes"),
  title: text("title"),
  titleCount: integer("title_count").notNull().default(0),
  metaDescription: text("meta_description"),
  descriptionCount: integer("description_count").notNull().default(0),
  canonicalUrl: text("canonical_url"),
  canonicalCount: integer("canonical_count").notNull().default(0),
  h1: text("h1"),
  h1Count: integer("h1_count").notNull().default(0),
  headings: jsonb("headings").$type<Array<{ level: number; text: string }>>().notNull().default([]),
  robotsDirectives: text("robots_directives").array().notNull().default([]),
  viewport: text("viewport"),
  hreflangCount: integer("hreflang_count").notNull().default(0),
  structuredDataTypes: text("structured_data_types").array().notNull().default([]),
  structuredDataErrorCount: integer("structured_data_error_count").notNull().default(0),
  mixedContentCount: integer("mixed_content_count").notNull().default(0),
  wordCount: integer("word_count").notNull().default(0),
  textHash: text("text_hash"),
  imageCount: integer("image_count").notNull().default(0),
  imagesWithoutAlt: integer("images_without_alt").notNull().default(0),
  inboundLinkCount: integer("inbound_link_count").notNull().default(0),
  outboundInternalLinkCount: integer("outbound_internal_link_count").notNull().default(0),
  redirectChain: text("redirect_chain").array().notNull().default([]),
  errorMessage: text("error_message"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [
  uniqueIndex("crawled_page_crawl_url_uq").on(table.crawlId, table.url),
  index("crawled_pages_project_url_idx").on(table.projectId, table.url),
  index("crawled_pages_hash_idx").on(table.crawlId, table.textHash)
]);

export const crawlLinks = pgTable("crawl_links", {
  id: uuid("id").defaultRandom().primaryKey(),
  crawlId: uuid("crawl_id").notNull().references(() => crawlJobs.id, { onDelete: "cascade" }),
  sourcePageId: uuid("source_page_id").notNull().references(() => crawledPages.id, { onDelete: "cascade" }),
  targetUrl: text("target_url").notNull(),
  anchorText: text("anchor_text"),
  linkType: text("link_type").notNull(),
  rel: text("rel"),
  targetStatusCode: integer("target_status_code"),
  isBroken: boolean("is_broken"),
  createdAt: createdAt()
}, (table) => [index("crawl_links_crawl_target_idx").on(table.crawlId, table.targetUrl), index("crawl_links_source_idx").on(table.sourcePageId)]);

export const seoIssues = pgTable("seo_issues", {
  id: uuid("id").defaultRandom().primaryKey(),
  crawlId: uuid("crawl_id").notNull().references(() => crawlJobs.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  pageId: uuid("page_id").references(() => crawledPages.id, { onDelete: "set null" }),
  issueKey: text("issue_key").notNull(),
  url: text("url").notNull(),
  category: text("category").notNull(),
  severity: issueSeverityEnum("severity").notNull(),
  description: text("description").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  recommendation: text("recommendation").notNull(),
  ruleVersion: text("rule_version").notNull(),
  detectedAt: timestamp("detected_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [index("seo_issues_project_crawl_idx").on(table.projectId, table.crawlId), index("seo_issues_severity_idx").on(table.crawlId, table.severity)]);

export const auditReports = pgTable("audit_reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  crawlId: uuid("crawl_id").notNull().unique().references(() => crawlJobs.id, { onDelete: "cascade" }),
  overallScore: integer("overall_score").notNull(),
  categoryScores: jsonb("category_scores").$type<Record<string, number | null>>().notNull(),
  issueCounts: jsonb("issue_counts").$type<Record<string, number>>().notNull(),
  scoreMethodologyVersion: text("score_methodology_version").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [index("audit_reports_project_generated_idx").on(table.projectId, table.generatedAt)]);

export const reportArtifacts = pgTable("report_artifacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  crawlId: uuid("crawl_id").notNull().references(() => crawlJobs.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  format: text("format").notNull(),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: createdAt()
}, (table) => [index("report_artifacts_project_time_idx").on(table.projectId, table.createdAt), index("report_artifacts_crawl_idx").on(table.crawlId)]);

export const keywords = pgTable("keywords", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  phrase: text("phrase").notNull(),
  country: text("country"),
  language: text("language"),
  intent: text("intent"),
  groupName: text("group_name"),
  source: text("source"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt()
}, (table) => [uniqueIndex("keyword_project_phrase_country_uq").on(table.projectId, table.phrase, table.country), index("keywords_project_idx").on(table.projectId)]);

export const keywordMetrics = pgTable("keyword_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  keywordId: uuid("keyword_id").notNull().references(() => keywords.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  estimatedSearchVolume: integer("estimated_search_volume"),
  difficulty: real("difficulty"),
  cpc: numeric("cpc", { precision: 12, scale: 4 }),
  organicClicks: integer("organic_clicks"),
  impressions: integer("impressions"),
  averagePosition: real("average_position"),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  sourcePayload: jsonb("source_payload").$type<Record<string, unknown>>().notNull().default({})
}, (table) => [index("keyword_metrics_history_idx").on(table.keywordId, table.observedAt)]);

export const rankObservations = pgTable("rank_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  keywordId: uuid("keyword_id").notNull().references(() => keywords.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  position: integer("position"),
  resultUrl: text("result_url"),
  device: text("device").notNull().default("desktop"),
  location: text("location"),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  sourcePayload: jsonb("source_payload").$type<Record<string, unknown>>().notNull().default({})
}, (table) => [index("rank_observations_keyword_time_idx").on(table.keywordId, table.observedAt)]);

export const backlinkSnapshots = pgTable("backlink_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  target: text("target").notNull(),
  totalBacklinks: numeric("total_backlinks", { precision: 20, scale: 0 }),
  referringDomains: numeric("referring_domains", { precision: 20, scale: 0 }),
  referringMainDomains: numeric("referring_main_domains", { precision: 20, scale: 0 }),
  referringIps: numeric("referring_ips", { precision: 20, scale: 0 }),
  domainRank: real("domain_rank"),
  sourceTaskId: text("source_task_id"),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [index("backlink_snapshots_project_time_idx").on(table.projectId, table.observedAt)]);

export const competitorSnapshots = pgTable("competitor_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  competitorDomain: text("competitor_domain").notNull(),
  intersections: integer("intersections"),
  averagePosition: real("average_position"),
  sourceTaskId: text("source_task_id"),
  observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [index("competitor_snapshots_project_time_idx").on(table.projectId, table.observedAt), index("competitor_snapshots_project_domain_idx").on(table.projectId, table.competitorDomain)]);

export const seoDataUsage = pgTable("seo_data_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  operation: text("operation").notNull(),
  externalTaskId: text("external_task_id"),
  estimatedCost: numeric("estimated_cost", { precision: 12, scale: 8 }),
  requestedAt: timestamp("requested_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [index("seo_data_usage_org_time_idx").on(table.organizationId, table.requestedAt), index("seo_data_usage_project_time_idx").on(table.projectId, table.requestedAt)]);

export const contentDocuments = pgTable("content_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  documentType: text("document_type").notNull().default("article"),
  targetKeyword: text("target_keyword"),
  status: text("status").notNull().default("draft"),
  content: text("content").notNull().default(""),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [index("content_documents_project_idx").on(table.projectId, table.updatedAt)]);

export const contentRevisions = pgTable("content_revisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => contentDocuments.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  changeSummary: text("change_summary"),
  createdBy: text("created_by").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: createdAt()
}, (table) => [uniqueIndex("content_revision_version_uq").on(table.documentId, table.version)]);

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  adapter: text("adapter").notNull(),
  baseUrl: text("base_url").notNull(),
  secretCiphertext: text("secret_ciphertext"),
  enabled: boolean("enabled").notNull().default(false),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const aiModels = pgTable("ai_models", {
  id: uuid("id").defaultRandom().primaryKey(),
  providerId: uuid("provider_id").notNull().references(() => aiProviders.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull(),
  capabilities: text("capabilities").array().notNull().default([]),
  inputCostPerMillion: numeric("input_cost_per_million", { precision: 12, scale: 6 }),
  outputCostPerMillion: numeric("output_cost_per_million", { precision: 12, scale: 6 }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt()
}, (table) => [uniqueIndex("ai_model_provider_id_uq").on(table.providerId, table.modelId)]);

export const aiTaskAssignments = pgTable("ai_task_assignments", {
  id: uuid("id").defaultRandom().primaryKey(),
  task: text("task").notNull(),
  modelId: uuid("model_id").notNull().references(() => aiModels.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt()
}, (table) => [uniqueIndex("ai_task_model_uq").on(table.task, table.modelId), index("ai_task_assignment_lookup_idx").on(table.task, table.priority)]);

export const aiConversations = pgTable("ai_conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  title: text("title").notNull().default("SEO assistant"),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [index("ai_conversations_org_idx").on(table.organizationId, table.updatedAt)]);

export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
  providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
  modelId: uuid("model_id").references(() => aiModels.id, { onDelete: "set null" }),
  createdAt: createdAt()
}, (table) => [index("ai_messages_conversation_idx").on(table.conversationId, table.createdAt)]);

export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
  modelId: uuid("model_id").references(() => aiModels.id, { onDelete: "set null" }),
  task: text("task").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  estimatedCost: numeric("estimated_cost", { precision: 12, scale: 8 }).notNull().default("0"),
  createdAt: createdAt()
}, (table) => [index("ai_usage_org_time_idx").on(table.organizationId, table.createdAt)]);

export const plans = pgTable("plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  priceMonthly: numeric("price_monthly", { precision: 10, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("USD"),
  crawlPageLimit: integer("crawl_page_limit").notNull(),
  projectLimit: integer("project_limit").notNull(),
  trackedKeywordLimit: integer("tracked_keyword_limit").notNull(),
  aiCredits: integer("ai_credits").notNull(),
  stripePriceId: text("stripe_price_id"),
  paystackPlanCode: text("paystack_plan_code"),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt()
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }).unique(),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "restrict" }),
  provider: text("provider").notNull().default("internal"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  providerActionTokenCiphertext: text("provider_action_token_ciphertext"),
  status: subscriptionStatusEnum("status").notNull().default("active"),
  periodStart: timestamp("period_start", { withTimezone: true, mode: "date" }),
  periodEnd: timestamp("period_end", { withTimezone: true, mode: "date" }),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [uniqueIndex("subscription_provider_id_uq").on(table.provider, table.providerSubscriptionId)]);

export const billingCheckoutSessions = pgTable("billing_checkout_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => plans.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  reference: text("reference").notNull().unique(),
  providerCheckoutId: text("provider_checkout_id"),
  checkoutUrl: text("checkout_url"),
  status: text("status").notNull().default("creating"),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt()
}, (table) => [
  uniqueIndex("billing_checkout_one_pending_org_uq").on(table.organizationId).where(sql`${table.status} in ('creating', 'pending')`),
  index("billing_checkout_org_status_idx").on(table.organizationId, table.status)
]);

export const usageRecords = pgTable("usage_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  quantity: integer("quantity").notNull().default(0),
  periodStart: timestamp("period_start", { withTimezone: true, mode: "date" }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: createdAt()
}, (table) => [uniqueIndex("usage_org_metric_period_uq").on(table.organizationId, table.metric, table.periodStart), index("usage_org_period_idx").on(table.organizationId, table.periodStart)]);

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  keyHash: text("key_hash").primaryKey(),
  count: integer("count").notNull().default(0),
  resetAt: timestamp("reset_at", { withTimezone: true, mode: "date" }).notNull()
}, (table) => [index("rate_limit_reset_idx").on(table.resetAt)]);

export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  receivedAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow()
}, (table) => [uniqueIndex("payment_webhook_provider_event_uq").on(table.provider, table.eventId), index("payment_webhook_received_idx").on(table.receivedAt)]);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: updatedAt()
});

export const adminAuditLogs = pgTable("admin_audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  actorId: text("actor_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt()
}, (table) => [index("admin_audit_actor_time_idx").on(table.actorId, table.createdAt)]);
