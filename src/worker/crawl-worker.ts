import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  auditReports,
  crawlJobs,
  crawlLinks,
  crawledPages,
  projects,
  seoIssues,
  usageRecords
} from "@/db/schema";
import { crawlWebsite } from "@/lib/crawler";
import { analyzeCrawl } from "@/lib/seo/analyze";
import { CRAWL_QUEUE, getBoss } from "@/lib/jobs/boss";

const jobSchema = z.object({ crawlId: z.string().uuid(), projectId: z.string().uuid() });

export async function processCrawl(crawlId: string) {
  const [crawl] = await db.select().from(crawlJobs).where(eq(crawlJobs.id, crawlId)).limit(1);
  if (!crawl || crawl.status === "cancelled" || crawl.status === "completed") return;
  const [project] = await db.select().from(projects).where(eq(projects.id, crawl.projectId)).limit(1);
  if (!project) throw new Error("The crawl project no longer exists.");

  await db.transaction(async (tx) => {
    await tx.delete(seoIssues).where(eq(seoIssues.crawlId, crawl.id));
    await tx.delete(auditReports).where(eq(auditReports.crawlId, crawl.id));
    await tx.delete(crawledPages).where(eq(crawledPages.crawlId, crawl.id));
    await tx.update(crawlJobs).set({
      status: "running",
      startedAt: new Date(),
      finishedAt: null,
      currentUrl: null,
      pagesProcessed: 0,
      pagesDiscovered: 0,
      errorMessage: null
    }).where(eq(crawlJobs.id, crawl.id));
  });

  const pageIds = new Map<string, string>();
  let insertedPages = 0;
  const result = await crawlWebsite({
    startUrl: project.websiteUrl,
    pageLimit: crawl.pageLimit,
    isCancelled: async () => {
      const [latest] = await db.select({ status: crawlJobs.status }).from(crawlJobs).where(eq(crawlJobs.id, crawl.id)).limit(1);
      return latest?.status === "cancelled";
    },
    onProgress: async ({ currentUrl, discovered, processed }) => {
      await db.update(crawlJobs).set({ currentUrl, pagesDiscovered: discovered, pagesProcessed: processed }).where(eq(crawlJobs.id, crawl.id));
    },
    onPage: async (page, progress) => {
      const [saved] = await db.insert(crawledPages).values({
        crawlId: crawl.id,
        projectId: project.id,
        url: page.requestedUrl,
        finalUrl: page.finalUrl,
        depth: page.depth,
        statusCode: page.statusCode || null,
        contentType: page.contentType || null,
        htmlBytes: page.htmlBytes || null,
        title: page.title,
        titleCount: page.titleCount,
        metaDescription: page.metaDescription,
        descriptionCount: page.descriptionCount,
        canonicalUrl: page.canonicalUrl,
        canonicalCount: page.canonicalCount,
        h1: page.h1,
        h1Count: page.h1Count,
        headings: page.headings,
        robotsDirectives: page.robotsDirectives,
        viewport: page.viewport,
        hreflangCount: page.hreflangCount,
        structuredDataTypes: page.structuredDataTypes,
        structuredDataErrorCount: page.structuredDataErrorCount,
        mixedContentCount: page.mixedContentCount,
        wordCount: page.wordCount,
        textHash: page.textHash,
        imageCount: page.imageCount,
        imagesWithoutAlt: page.imagesWithoutAlt,
        outboundInternalLinkCount: page.outboundInternalLinkCount,
        redirectChain: page.redirectChain,
        errorMessage: page.errorMessage
      }).onConflictDoUpdate({
        target: [crawledPages.crawlId, crawledPages.url],
        set: { statusCode: page.statusCode || null, errorMessage: page.errorMessage, fetchedAt: new Date() }
      }).returning({ id: crawledPages.id });
      pageIds.set(page.requestedUrl, saved.id);
      insertedPages += 1;
      if (page.links.length) {
        await db.insert(crawlLinks).values(page.links.map((link) => ({
          crawlId: crawl.id,
          sourcePageId: saved.id,
          targetUrl: link.targetUrl,
          anchorText: link.anchorText || null,
          linkType: link.linkType,
          rel: link.rel
        })));
      }
      await db.update(crawlJobs).set({
        pagesProcessed: progress.processed,
        pagesDiscovered: progress.discovered,
        currentUrl: page.requestedUrl
      }).where(eq(crawlJobs.id, crawl.id));
    }
  });

  const [latest] = await db.select({ status: crawlJobs.status }).from(crawlJobs).where(eq(crawlJobs.id, crawl.id)).limit(1);
  if (latest?.status === "cancelled") {
    await db.update(crawlJobs).set({ finishedAt: new Date(), currentUrl: null }).where(eq(crawlJobs.id, crawl.id));
    return;
  }

  const snapshots = result.pages;
  const analysis = analyzeCrawl(snapshots, result.warnings, project.websiteUrl);
  const statusByUrl = new Map<string, number>();
  for (const page of snapshots) {
    statusByUrl.set(normalizeUrl(page.requestedUrl), page.statusCode);
    statusByUrl.set(normalizeUrl(page.finalUrl), page.statusCode);
  }
  const links = await db.select({ id: crawlLinks.id, targetUrl: crawlLinks.targetUrl }).from(crawlLinks).where(eq(crawlLinks.crawlId, crawl.id));
  for (const link of links) {
    const status = statusByUrl.get(normalizeUrl(link.targetUrl));
    if (status !== undefined) await db.update(crawlLinks).set({ targetStatusCode: status, isBroken: status >= 400 }).where(eq(crawlLinks.id, link.id));
  }

  const issueRows = analysis.findings.map((finding) => ({
    crawlId: crawl.id,
    projectId: project.id,
    pageId: finding.pageUrl ? pageIds.get(finding.pageUrl) ?? null : null,
    issueKey: finding.issueKey,
    url: finding.url,
    category: finding.category,
    severity: finding.severity,
    description: finding.description,
    evidence: finding.evidence,
    recommendation: finding.recommendation,
    ruleVersion: finding.ruleVersion
  }));

  await db.transaction(async (tx) => {
    for (let offset = 0; offset < issueRows.length; offset += 500) {
      await tx.insert(seoIssues).values(issueRows.slice(offset, offset + 500));
    }
    await tx.insert(auditReports).values({
      projectId: project.id,
      crawlId: crawl.id,
      overallScore: analysis.overallScore,
      categoryScores: analysis.categoryScores,
      issueCounts: analysis.issueCounts,
      scoreMethodologyVersion: analysis.methodologyVersion
    });
    await tx.update(crawlJobs).set({
      status: "completed",
      finishedAt: new Date(),
      currentUrl: null,
      pagesProcessed: insertedPages,
      pagesDiscovered: result.discoveredCount,
      errorMessage: result.warnings.length ? result.warnings.slice(0, 5).join(" ").slice(0, 1_000) : null
    }).where(eq(crawlJobs.id, crawl.id));

    const [membership] = await tx.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, project.id)).limit(1);
    if (membership && insertedPages > 0) {
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      await tx.insert(usageRecords).values({
        organizationId: membership.organizationId,
        metric: "crawled_pages",
        quantity: insertedPages,
        periodStart,
        periodEnd
      }).onConflictDoUpdate({
        target: [usageRecords.organizationId, usageRecords.metric, usageRecords.periodStart],
        set: { quantity: sql`${usageRecords.quantity} + ${insertedPages}` }
      });
    }
  });
}

export async function registerCrawlWorker() {
  const boss = await getBoss();
  await boss.work<{ crawlId: string; projectId: string }>(CRAWL_QUEUE, {
    localConcurrency: 2,
    groupConcurrency: 1,
    batchSize: 1,
    pollingIntervalSeconds: 2
  }, async (jobs) => {
    for (const job of jobs) {
      const parsed = jobSchema.safeParse(job.data);
      if (!parsed.success) {
        console.error("Discarding invalid crawl job payload", { jobId: job.id });
        continue;
      }
      try {
        await processCrawl(parsed.data.crawlId);
      } catch (error) {
        const message = error instanceof Error ? error.message : "The crawl failed unexpectedly.";
        await db.update(crawlJobs).set({ status: "failed", errorMessage: message.slice(0, 1_000), finishedAt: new Date(), currentUrl: null }).where(and(eq(crawlJobs.id, parsed.data.crawlId), sql`${crawlJobs.status} <> 'cancelled'`));
        throw error;
      }
    }
  });
  return boss;
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return value; }
}
