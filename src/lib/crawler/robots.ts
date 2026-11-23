import robotsParser from "robots-parser";
import { safeFetchText } from "@/lib/crawler/fetcher";

export interface RobotsPolicy {
  allows(url: string): boolean;
  crawlDelayMs: number;
  sitemaps: string[];
  warning: string | null;
}

export async function loadRobotsPolicy(origin: URL, userAgent: string, allowedHosts: string[]): Promise<RobotsPolicy> {
  const robotsUrl = new URL("/robots.txt", origin).toString();
  try {
    const response = await safeFetchText(robotsUrl, {
      accept: "text/plain,*/*;q=0.1",
      maxBytes: 512_000,
      timeoutMs: 10_000,
      allowedHosts
    });
    if (response.statusCode >= 500 || response.statusCode === 429) {
      const denyAll = robotsParser(robotsUrl, "User-agent: *\nDisallow: /");
      return { allows: (url) => denyAll.isAllowed(url, userAgent) === true, crawlDelayMs: 1_000, sitemaps: [], warning: `robots.txt returned HTTP ${response.statusCode}; crawling was stopped conservatively.` };
    }
    if (response.statusCode >= 400) return { allows: () => true, crawlDelayMs: 250, sitemaps: [], warning: null };
    const parser = robotsParser(robotsUrl, response.body);
    const delaySeconds = parser.getCrawlDelay(userAgent) ?? parser.getCrawlDelay("*") ?? 0.25;
    return {
      allows: (url) => parser.isAllowed(url, userAgent) !== false,
      crawlDelayMs: Math.min(10_000, Math.max(250, delaySeconds * 1_000)),
      sitemaps: parser.getSitemaps().slice(0, 10),
      warning: null
    };
  } catch (error) {
    const denyAll = robotsParser(robotsUrl, "User-agent: *\nDisallow: /");
    return {
      allows: (url) => denyAll.isAllowed(url, userAgent) === true,
      crawlDelayMs: 1_000,
      sitemaps: [],
      warning: `robots.txt could not be read; crawling was stopped conservatively (${error instanceof Error ? error.message : "network error"}).`
    };
  }
}
