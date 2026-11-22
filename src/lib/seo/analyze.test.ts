import { describe, expect, it } from "vitest";
import { createFailedPage, parseHtmlPage, type PageSnapshot } from "@/lib/crawler/parser";
import { analyzeCrawl } from "@/lib/seo/analyze";

function parsedPage(url: string, html: string, depth = 0) {
  return parseHtmlPage({ html, requestedUrl: url, finalUrl: url, depth, statusCode: 200, contentType: "text/html", redirectChain: [], allowedHosts: ["example.com"] });
}

describe("deterministic SEO analysis", () => {
  it("finds missing metadata, heading issues, mixed content, invalid schema and broken internal links", () => {
    const home = parsedPage("https://example.com/", `
      <html><head><title>Home</title><meta name="viewport" content="width=device-width"><script src="http://assets.example.com/app.js"></script><script type="application/ld+json">{broken}</script></head>
      <body><h1>Welcome</h1><h3>Skipped level</h3><img src="/hero.jpg"><a href="/missing">Old page</a></body></html>`);
    const missing = createFailedPage({ requestedUrl: "https://example.com/missing", finalUrl: "https://example.com/missing", depth: 1, statusCode: 404, errorMessage: "The page returned HTTP 404." });
    const analysis = analyzeCrawl([home, missing], [], "https://example.com/");
    const keys = analysis.findings.map((finding) => finding.issueKey);
    expect(keys).toContain("missing_meta_description");
    expect(keys).toContain("heading_hierarchy");
    expect(keys).toContain("mixed_content");
    expect(keys).toContain("invalid_structured_data");
    expect(keys).toContain("images_missing_alt");
    expect(keys).toContain("http_error");
    expect(keys).toContain("broken_internal_link");
    expect(analysis.issueCounts.high).toBeGreaterThan(0);
    expect(analysis.overallScore).toBeGreaterThanOrEqual(0);
    expect(analysis.overallScore).toBeLessThan(100);
    expect(analysis.categoryScores.performance).toBeNull();
  });

  it("detects duplicate titles/descriptions/content across analyzed URLs", () => {
    const shared = `<html><head><title>Shared title</title><meta name="description" content="Same description"><meta name="viewport" content="width=device-width"></head><body><h1>Shared heading</h1><p>Identical useful page content.</p></body></html>`;
    const pages = [parsedPage("https://example.com/a", shared), parsedPage("https://example.com/b", shared, 1)];
    const analysis = analyzeCrawl(pages, [], "https://example.com/a");
    expect(analysis.findings.filter((finding) => finding.issueKey === "duplicate_title")).toHaveLength(2);
    expect(analysis.findings.filter((finding) => finding.issueKey === "duplicate_meta_description")).toHaveLength(2);
    expect(analysis.findings.filter((finding) => finding.issueKey === "duplicate_content_indicator")).toHaveLength(2);
  });

  it("does not invent category values when there are no measured pages", () => {
    const analysis = analyzeCrawl([]);
    expect(analysis.overallScore).toBe(0);
    expect(analysis.categoryScores.performance).toBeNull();
    expect(analysis.categoryScores.technical).toBeNull();
  });

  it("uses a stable rule version and score method", () => {
    const page: PageSnapshot = parsedPage("https://example.com/", `<html><head><title>Good</title><meta name="description" content="Specific"><meta name="viewport" content="width=device-width"></head><body><h1>Good page</h1><p>${"Helpful information. ".repeat(40)}</p></body></html>`);
    const first = analyzeCrawl([page], [], page.requestedUrl);
    const second = analyzeCrawl([page], [], page.requestedUrl);
    expect(first.methodologyVersion).toBe("2026.1");
    expect(first.overallScore).toBe(second.overallScore);
    expect(first.findings).toEqual(second.findings);
  });
});
