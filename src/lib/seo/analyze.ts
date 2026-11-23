import type { PageSnapshot } from "@/lib/crawler/parser";
import type { IssueSeverity } from "@/lib/seo/types";

export interface SeoFinding {
  issueKey: string;
  url: string;
  category: "technical" | "on_page" | "content" | "performance" | "internal_links" | "structured_data";
  severity: IssueSeverity;
  description: string;
  evidence: Record<string, unknown>;
  recommendation: string;
  ruleVersion: string;
  pageUrl: string | null;
}

export interface SeoAnalysis {
  findings: SeoFinding[];
  categoryScores: Record<string, number | null>;
  overallScore: number;
  issueCounts: Record<IssueSeverity, number>;
  methodologyVersion: string;
}

export const SEO_RULE_VERSION = "2026.1";

export function analyzeCrawl(pages: PageSnapshot[], warnings: string[] = [], rootUrl?: string): SeoAnalysis {
  const findings: SeoFinding[] = [];
  const add = (input: Omit<SeoFinding, "ruleVersion">) => findings.push({ ...input, ruleVersion: SEO_RULE_VERSION });

  for (const page of pages) {
    const pageUrl = page.requestedUrl;
    const nonHtml = page.errorMessage?.startsWith("Skipped non-HTML") ?? false;

    if (page.statusCode >= 400) {
      add({ issueKey: "http_error", url: pageUrl, pageUrl, category: "technical", severity: page.statusCode >= 500 ? "critical" : "high", description: `The URL returned HTTP ${page.statusCode}.`, evidence: { statusCode: page.statusCode, finalUrl: page.finalUrl }, recommendation: "Restore the page or update internal links and the sitemap to point to a valid destination." });
    } else if (page.statusCode === 0 && !nonHtml) {
      add({ issueKey: "fetch_failed", url: pageUrl, pageUrl, category: "technical", severity: "high", description: page.errorMessage ?? "The page could not be fetched.", evidence: { error: page.errorMessage }, recommendation: "Check that the page is publicly reachable, responds in a timely manner and permits the configured crawler." });
    }

    if (new URL(page.requestedUrl).protocol === "http:" && new URL(page.finalUrl).protocol === "http:") {
      add({ issueKey: "https_not_used", url: pageUrl, pageUrl, category: "technical", severity: "high", description: "This page is served over HTTP rather than HTTPS.", evidence: { url: page.finalUrl }, recommendation: "Serve the page over HTTPS and redirect HTTP requests to the secure URL." });
    }
    if (page.redirectChain.length > 1) {
      add({ issueKey: "redirect_chain", url: pageUrl, pageUrl, category: "technical", severity: "medium", description: `The URL passes through ${page.redirectChain.length} redirects before reaching its final destination.`, evidence: { chain: [...page.redirectChain, page.finalUrl] }, recommendation: "Update internal links to point directly to the final URL and remove unnecessary redirect hops." });
    }
    if (nonHtml) continue;

    if (!page.title) {
      add({ issueKey: "missing_title", url: pageUrl, pageUrl, category: "on_page", severity: "high", description: "The page is missing a non-empty title element.", evidence: { titleCount: page.titleCount }, recommendation: "Add a concise, unique title that accurately describes the page for people and search engines." });
    } else if (page.titleCount > 1) {
      add({ issueKey: "multiple_title_tags", url: pageUrl, pageUrl, category: "on_page", severity: "medium", description: "The page contains more than one title element.", evidence: { title: page.title, titleCount: page.titleCount }, recommendation: "Keep a single descriptive title element in the document head." });
    }
    if (!page.metaDescription) {
      add({ issueKey: "missing_meta_description", url: pageUrl, pageUrl, category: "on_page", severity: "medium", description: "The page is missing a non-empty meta description.", evidence: { descriptionCount: page.descriptionCount }, recommendation: "Write a useful, page-specific summary. Search engines may choose a different snippet." });
    } else if (page.descriptionCount > 1) {
      add({ issueKey: "multiple_meta_descriptions", url: pageUrl, pageUrl, category: "on_page", severity: "low", description: "The page contains multiple meta description tags.", evidence: { descriptionCount: page.descriptionCount }, recommendation: "Keep one page-specific meta description." });
    }
    if (!page.h1) {
      add({ issueKey: "missing_h1", url: pageUrl, pageUrl, category: "on_page", severity: "medium", description: "No non-empty level-one heading was found.", evidence: { h1Count: page.h1Count }, recommendation: "Add a clear primary heading that reflects the page's main subject." });
    } else if (page.h1Count > 1) {
      add({ issueKey: "multiple_h1", url: pageUrl, pageUrl, category: "on_page", severity: "low", description: `The page contains ${page.h1Count} H1 headings.`, evidence: { h1Count: page.h1Count }, recommendation: "Use one clear primary heading, then structure supporting sections with H2 and lower-level headings." });
    }
    const hierarchyJump = page.headings.find((heading, index) => index > 0 && heading.level > page.headings[index - 1]!.level + 1);
    if (hierarchyJump) {
      add({ issueKey: "heading_hierarchy", url: pageUrl, pageUrl, category: "on_page", severity: "low", description: "The heading outline skips a level.", evidence: { headings: page.headings.slice(0, 20), firstJump: hierarchyJump }, recommendation: "Use heading levels in order to make the document outline easier to navigate." });
    }
    if (page.canonicalCount > 1) {
      add({ issueKey: "multiple_canonicals", url: pageUrl, pageUrl, category: "technical", severity: "medium", description: "More than one canonical link was found.", evidence: { canonicalCount: page.canonicalCount, canonicalUrl: page.canonicalUrl }, recommendation: "Keep one canonical link and point it to the intended preferred URL." });
    } else if (page.canonicalUrl && !isHttpUrl(page.canonicalUrl)) {
      add({ issueKey: "invalid_canonical", url: pageUrl, pageUrl, category: "technical", severity: "high", description: "The canonical link is not a valid HTTP or HTTPS URL.", evidence: { canonicalUrl: page.canonicalUrl }, recommendation: "Correct the canonical URL so it resolves to the preferred page." });
    }
    if (page.robotsDirectives.includes("noindex")) {
      add({ issueKey: "noindex_directive", url: pageUrl, pageUrl, category: "technical", severity: "info", description: "The page contains a noindex directive; this may be intentional.", evidence: { directives: page.robotsDirectives }, recommendation: "Confirm that this page is intentionally excluded from search indexing." });
    }
    if (!page.viewport) {
      add({ issueKey: "missing_viewport", url: pageUrl, pageUrl, category: "technical", severity: "medium", description: "The page has no viewport meta tag.", evidence: {}, recommendation: "Add a responsive viewport declaration so mobile browsers size the page appropriately." });
    }
    if (page.imagesWithoutAlt > 0) {
      add({ issueKey: "images_missing_alt", url: pageUrl, pageUrl, category: "on_page", severity: "medium", description: `${page.imagesWithoutAlt} of ${page.imageCount} image(s) have no useful alt text.`, evidence: { imageCount: page.imageCount, imagesWithoutAlt: page.imagesWithoutAlt }, recommendation: "Add concise alternative text to informative images; use an empty alt value for decorative images." });
    }
    if (page.wordCount > 0 && page.wordCount < 200) {
      add({ issueKey: "thin_content_indicator", url: pageUrl, pageUrl, category: "content", severity: "low", description: `The extracted page contains ${page.wordCount} words, which is a thin-content review signal, not a ranking rule.`, evidence: { wordCount: page.wordCount }, recommendation: "Review whether the page fully answers its intended visitor need. Add useful substance only where it improves the page." });
    }
    if (page.mixedContentCount > 0 && new URL(page.finalUrl).protocol === "https:") {
      add({ issueKey: "mixed_content", url: pageUrl, pageUrl, category: "technical", severity: "high", description: `${page.mixedContentCount} resource URL(s) use HTTP on this HTTPS page.`, evidence: { mixedContentCount: page.mixedContentCount }, recommendation: "Serve page resources over HTTPS or remove insecure references." });
    }
    if (page.structuredDataErrorCount > 0) {
      add({ issueKey: "invalid_structured_data", url: pageUrl, pageUrl, category: "structured_data", severity: "medium", description: `${page.structuredDataErrorCount} JSON-LD block(s) could not be parsed as JSON.`, evidence: { invalidBlockCount: page.structuredDataErrorCount }, recommendation: "Validate each JSON-LD block as JSON and then check its vocabulary and required properties against the relevant schema documentation." });
    }
    if (page.depth > 4) {
      add({ issueKey: "excessive_crawl_depth", url: pageUrl, pageUrl, category: "internal_links", severity: "low", description: `The page was discovered at crawl depth ${page.depth}.`, evidence: { depth: page.depth }, recommendation: "Consider adding a relevant internal link from a more prominent page if this page is important." });
    }
    if (page.outboundInternalLinkCount > 100) {
      add({ issueKey: "many_internal_links", url: pageUrl, pageUrl, category: "internal_links", severity: "low", description: `The page contains ${page.outboundInternalLinkCount} unique internal links.`, evidence: { outboundInternalLinkCount: page.outboundInternalLinkCount }, recommendation: "Review whether every link is useful and accessible; there is no universal ideal link count." });
    }
  }

  const duplicateGroups = groupBy(pages.filter((page) => page.title), (page) => normalize(page.title!));
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue;
    for (const page of group) add({
      issueKey: "duplicate_title",
      url: page.requestedUrl,
      pageUrl: page.requestedUrl,
      category: "on_page",
      severity: "high",
      description: "This page shares its title with another crawled page.",
      evidence: { title: page.title, duplicates: group.map((item) => item.requestedUrl) },
      recommendation: "Write a distinct title that reflects the specific purpose of each page."
    });
  }

  const duplicateDescriptions = groupBy(pages.filter((page) => page.metaDescription), (page) => normalize(page.metaDescription!));
  for (const group of duplicateDescriptions.values()) {
    if (group.length < 2) continue;
    for (const page of group) add({
      issueKey: "duplicate_meta_description",
      url: page.requestedUrl,
      pageUrl: page.requestedUrl,
      category: "on_page",
      severity: "medium",
      description: "This page shares its meta description with another crawled page.",
      evidence: { metaDescription: page.metaDescription, duplicates: group.map((item) => item.requestedUrl) },
      recommendation: "Use a unique, accurate description for each important page."
    });
  }

  const duplicateHashes = groupBy(pages.filter((page) => page.textHash), (page) => page.textHash!);
  for (const group of duplicateHashes.values()) {
    if (group.length < 2) continue;
    for (const page of group) add({
      issueKey: "duplicate_content_indicator",
      url: page.requestedUrl,
      pageUrl: page.requestedUrl,
      category: "content",
      severity: "medium",
      description: "The extracted visible text matches another page in this crawl.",
      evidence: { textHash: page.textHash, duplicateUrls: group.map((item) => item.requestedUrl) },
      recommendation: "Check whether the pages are intentionally duplicates. Consolidate or make the visitor value and canonical treatment clear where appropriate."
    });
  }

  const pageByUrl = new Map<string, PageSnapshot>();
  for (const page of pages) {
    pageByUrl.set(normalizeUrl(page.requestedUrl), page);
    pageByUrl.set(normalizeUrl(page.finalUrl), page);
  }
  const inbound = new Map<string, number>();
  for (const page of pages) {
    for (const link of page.links) {
      if (link.linkType !== "internal") continue;
      const target = pageByUrl.get(normalizeUrl(link.targetUrl));
      if (target) inbound.set(target.requestedUrl, (inbound.get(target.requestedUrl) ?? 0) + 1);
      if (target && target.statusCode >= 400) {
        add({
          issueKey: "broken_internal_link",
          url: page.requestedUrl,
          pageUrl: page.requestedUrl,
          category: "internal_links",
          severity: "high",
          description: `An internal link points to a URL returning HTTP ${target.statusCode}.`,
          evidence: { targetUrl: link.targetUrl, statusCode: target.statusCode, anchorText: link.anchorText },
          recommendation: "Update the link to a working destination or remove it if the page is no longer needed."
        });
      }
    }
  }
  const root = rootUrl ? normalizeUrl(rootUrl) : null;
  for (const page of pages) {
    if (page.statusCode < 200 || page.statusCode >= 300 || !page.contentType.includes("html")) continue;
    const incoming = inbound.get(page.requestedUrl) ?? 0;
    if (incoming === 0 && (!root || normalizeUrl(page.requestedUrl) !== root)) {
      add({
        issueKey: "orphan_page_candidate",
        url: page.requestedUrl,
        pageUrl: page.requestedUrl,
        category: "internal_links",
        severity: "low",
        description: "No inbound internal links to this page were found in the analyzed crawl.",
        evidence: { crawlDepth: page.depth, inboundInternalLinks: 0 },
        recommendation: "If this page is important, add a contextual internal link from a relevant, crawlable page. This is a crawl-limited candidate, not proof the page is globally orphaned."
      });
    }
  }

  for (const warning of warnings) {
    if (warning.startsWith("robots.txt")) continue;
    add({ issueKey: "sitemap_or_crawl_warning", url: rootUrl ?? "", pageUrl: null, category: "technical", severity: "low", description: warning, evidence: { warning }, recommendation: "Review the warning and confirm that site discovery and crawl limits are configured as intended." });
  }

  const issueCounts: Record<IssueSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const finding of findings) issueCounts[finding.severity] += 1;
  const hasStructuredData = pages.some((page) => page.structuredDataTypes.length > 0 || page.structuredDataErrorCount > 0);
  const categoryScores: Record<string, number | null> = {
    technical: scoreCategory(findings, "technical", pages.length),
    on_page: scoreCategory(findings, "on_page", pages.length),
    content: scoreCategory(findings, "content", pages.length),
    performance: null,
    internal_links: scoreCategory(findings, "internal_links", pages.length),
    structured_data: hasStructuredData ? scoreCategory(findings, "structured_data", pages.length) : null
  };
  const weights: Record<string, number> = { technical: 0.28, on_page: 0.24, content: 0.17, performance: 0.1, internal_links: 0.13, structured_data: 0.08 };
  const available = Object.entries(categoryScores).filter((entry): entry is [string, number] => entry[1] !== null);
  const totalWeight = available.reduce((sum, [category]) => sum + weights[category]!, 0);
  const overallScore = available.length === 0 ? 0 : Math.round(available.reduce((sum, [category, score]) => sum + score * weights[category]!, 0) / totalWeight);
  return { findings, categoryScores, overallScore, issueCounts, methodologyVersion: SEO_RULE_VERSION };
}

const severityPenalty: Record<IssueSeverity, number> = { critical: 20, high: 12, medium: 6, low: 2, info: 0 };

function scoreCategory(findings: SeoFinding[], category: SeoFinding["category"], pageCount: number) {
  if (pageCount === 0) return null;
  const penalty = findings.filter((finding) => finding.category === category)
    .reduce((sum, finding) => sum + severityPenalty[finding.severity], 0);
  return Math.max(0, Math.min(100, Math.round(100 - (penalty / pageCount) * 3)));
}

function normalize(value: string) {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function normalizeUrl(value: string) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch { return false; }
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const group = result.get(key(item)) ?? [];
    group.push(item);
    result.set(key(item), group);
  }
  return result;
}
