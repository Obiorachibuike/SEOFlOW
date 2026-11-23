import * as cheerio from "cheerio";
import { safeFetchText } from "@/lib/crawler/fetcher";

export interface SitemapDiscovery {
  urls: string[];
  errors: string[];
}

export async function discoverSitemapUrls(input: {
  origin: URL;
  robotsSitemaps: string[];
  allowedHosts: string[];
  maxUrls: number;
}) {
  const urls = new Set<string>();
  const errors: string[] = [];
  const queue = [...input.robotsSitemaps];
  const conventional = new URL("/sitemap.xml", input.origin).toString();
  if (!queue.includes(conventional)) queue.push(conventional);
  const visited = new Set<string>();
  let sitemapCount = 0;

  while (queue.length && sitemapCount < 10 && urls.size < input.maxUrls) {
    const sitemapUrl = queue.shift()!;
    if (visited.has(sitemapUrl)) continue;
    visited.add(sitemapUrl);
    try {
      const parsed = new URL(sitemapUrl);
      if (!input.allowedHosts.includes(parsed.hostname.toLowerCase())) continue;
      const response = await safeFetchText(sitemapUrl, {
        accept: "application/xml,text/xml,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        maxBytes: 1_048_576,
        timeoutMs: 10_000,
        allowedHosts: input.allowedHosts
      });
      sitemapCount += 1;
      if (response.statusCode === 404 || response.statusCode === 410) continue;
      if (response.statusCode < 200 || response.statusCode >= 300) {
        errors.push(`${sitemapUrl} returned HTTP ${response.statusCode}.`);
        continue;
      }
      const $ = cheerio.load(response.body, { xmlMode: true });
      const isIndex = $("sitemapindex").length > 0;
      if (isIndex) {
        $("sitemap > loc").each((_, item) => {
          if (queue.length < 10) queue.push($(item).text().trim());
        });
      } else {
        $("url > loc").each((_, item) => {
          if (urls.size >= input.maxUrls) return;
          try {
            const target = new URL($(item).text().trim());
            if (input.allowedHosts.includes(target.hostname.toLowerCase()) && ["http:", "https:"].includes(target.protocol)) {
              target.hash = "";
              urls.add(target.toString());
            }
          } catch { /* invalid sitemap entries are ignored */ }
        });
      }
    } catch (error) {
      errors.push(`${sitemapUrl}: ${error instanceof Error ? error.message : "could not be read"}`);
    }
  }
  return { urls: [...urls], errors } satisfies SitemapDiscovery;
}
