import { createFailedPage, parseHtmlPage, type PageSnapshot } from "@/lib/crawler/parser";
import { safeFetchText, CrawlFetchError } from "@/lib/crawler/fetcher";
import { loadRobotsPolicy } from "@/lib/crawler/robots";
import { discoverSitemapUrls } from "@/lib/crawler/sitemap";

export interface CrawlResult {
  pages: PageSnapshot[];
  discoveredCount: number;
  warnings: string[];
  robotsBlockedCount: number;
  durationMs: number;
}

export async function crawlWebsite(input: {
  startUrl: string;
  pageLimit: number;
  userAgent?: string;
  isCancelled?: () => Promise<boolean>;
  onPage?: (page: PageSnapshot, progress: { discovered: number; processed: number }) => Promise<void>;
  onProgress?: (progress: { currentUrl: string | null; discovered: number; processed: number }) => Promise<void>;
}): Promise<CrawlResult> {
  const startedAt = Date.now();
  const start = new URL(input.startUrl);
  const normalizedHost = start.hostname.toLowerCase();
  const allowedHosts = [normalizedHost, normalizedHost.startsWith("www.") ? normalizedHost.slice(4) : `www.${normalizedHost}`];
  const userAgent = input.userAgent ?? process.env.CRAWL_USER_AGENT ?? "SEOFlowBot/1.0 (+https://example.com/crawler)";
  const limit = Math.max(1, Math.min(input.pageLimit, Number(process.env.CRAWL_MAX_PAGES_HARD_LIMIT ?? 10_000)));
  const pages: PageSnapshot[] = [];
  const warnings: string[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: start.toString(), depth: 0 }];
  const queued = new Set([start.toString()]);
  const robots = await loadRobotsPolicy(start, userAgent, allowedHosts);
  if (robots.warning) warnings.push(robots.warning);
  const sitemap = await discoverSitemapUrls({
    origin: start,
    robotsSitemaps: robots.sitemaps,
    allowedHosts,
    maxUrls: Math.min(limit * 3, 3_000)
  });
  warnings.push(...sitemap.errors.slice(0, 10));
  for (const url of sitemap.urls) {
    if (queued.size >= limit * 3) break;
    if (!queued.has(url)) {
      queued.add(url);
      queue.push({ url, depth: 0 });
    }
  }

  let robotsBlockedCount = 0;
  let processed = 0;
  let lastRequestAt = 0;
  const internalCandidates = new Set<string>();

  while (queue.length && pages.length < limit) {
    if (await input.isCancelled?.()) break;
    const item = queue.shift()!;
    if (!robots.allows(item.url)) {
      robotsBlockedCount += 1;
      continue;
    }
    const waitMs = Math.max(0, robots.crawlDelayMs - (Date.now() - lastRequestAt));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestAt = Date.now();
    await input.onProgress?.({ currentUrl: item.url, discovered: queued.size, processed });

    let page: PageSnapshot;
    try {
      const response = await safeFetchText(item.url, { allowedHosts });
      const htmlType = response.contentType === "text/html" || response.contentType === "application/xhtml+xml";
      if (response.statusCode < 200 || response.statusCode >= 300) {
        page = createFailedPage({ requestedUrl: item.url, finalUrl: response.finalUrl, depth: item.depth, statusCode: response.statusCode, contentType: response.contentType, redirectChain: response.redirectChain, errorMessage: `The page returned HTTP ${response.statusCode}.` });
      } else if (!htmlType) {
        page = createFailedPage({ requestedUrl: item.url, finalUrl: response.finalUrl, depth: item.depth, statusCode: response.statusCode, contentType: response.contentType, redirectChain: response.redirectChain, errorMessage: `Skipped non-HTML content (${response.contentType || "unknown content type"}).` });
      } else {
        page = parseHtmlPage({
          html: response.body,
          requestedUrl: item.url,
          finalUrl: response.finalUrl,
          depth: item.depth,
          statusCode: response.statusCode,
          contentType: response.contentType,
          redirectChain: response.redirectChain,
          allowedHosts
        });
        for (const link of page.links) {
          if (link.linkType !== "internal") continue;
          internalCandidates.add(link.targetUrl);
          if (item.depth >= 20 || queued.size >= limit * 3 || queued.has(link.targetUrl)) continue;
          queued.add(link.targetUrl);
          queue.push({ url: link.targetUrl, depth: item.depth + 1 });
        }
      }
    } catch (error) {
      page = createFailedPage({
        requestedUrl: item.url,
        depth: item.depth,
        statusCode: error instanceof CrawlFetchError ? error.statusCode : undefined,
        errorMessage: error instanceof Error ? error.message : "The page could not be fetched."
      });
    }

    pages.push(page);
    processed += 1;
    await input.onPage?.(page, { discovered: queued.size, processed });
    await input.onProgress?.({ currentUrl: item.url, discovered: queued.size, processed });
  }

  if (robotsBlockedCount > 0) warnings.push(`${robotsBlockedCount} URL(s) were not crawled because robots.txt disallowed them.`);
  if (queue.length && pages.length >= limit) warnings.push(`The crawl reached its ${limit} page limit. Increase the project limit to analyze more URLs.`);
  if (pages.length === 0 && !warnings.some((warning) => warning.includes("robots.txt"))) warnings.push("No crawlable HTML pages were found.");
  return { pages, discoveredCount: Math.max(queued.size, internalCandidates.size), warnings, robotsBlockedCount, durationMs: Date.now() - startedAt };
}
