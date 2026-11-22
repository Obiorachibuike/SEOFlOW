import { describe, expect, it } from "vitest";
import { parseHtmlPage } from "@/lib/crawler/parser";

describe("HTML extraction", () => {
  it("extracts technical signals, content hashes and scoped links", () => {
    const page = parseHtmlPage({
      html: `<!doctype html><html><head><title>Example page</title><meta name="description" content="A useful description"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="canonical" href="/article"><script type="application/ld+json">{"@type":"Article"}</script><script type="application/ld+json">{not json}</script><script src="http://cdn.example.test/library.js"></script></head><body><h1>Example heading</h1><h3>Skipped heading</h3><p>Useful content for visitors.</p><img src="/image.jpg"><a href="/next#section">Read next</a><a href="https://outside.test/resource">External</a></body></html>`,
      requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/",
      depth: 0,
      statusCode: 200,
      contentType: "text/html",
      redirectChain: [],
      allowedHosts: ["example.com", "www.example.com"]
    });

    expect(page.title).toBe("Example page");
    expect(page.metaDescription).toBe("A useful description");
    expect(page.canonicalUrl).toBe("https://example.com/article");
    expect(page.h1Count).toBe(1);
    expect(page.headings.map((heading) => heading.level)).toEqual([1, 3]);
    expect(page.viewport).toContain("width=device-width");
    expect(page.structuredDataTypes).toContain("Article");
    expect(page.structuredDataErrorCount).toBe(1);
    expect(page.imageCount).toBe(1);
    expect(page.imagesWithoutAlt).toBe(1);
    expect(page.mixedContentCount).toBe(1);
    expect(page.links).toHaveLength(2);
    expect(page.links[0]).toMatchObject({ linkType: "internal", targetUrl: "https://example.com/next" });
    expect(page.links[1]?.linkType).toBe("external");
    expect(page.wordCount).toBeGreaterThan(0);
    expect(page.textHash).toHaveLength(64);
  });
});
