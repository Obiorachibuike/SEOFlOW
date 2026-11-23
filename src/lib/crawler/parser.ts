import { createHash } from "node:crypto";
import * as cheerio from "cheerio";

export interface PageLink {
  targetUrl: string;
  anchorText: string;
  linkType: "internal" | "external";
  rel: string | null;
}

export interface PageSnapshot {
  requestedUrl: string;
  finalUrl: string;
  depth: number;
  statusCode: number;
  contentType: string;
  htmlBytes: number;
  title: string | null;
  titleCount: number;
  metaDescription: string | null;
  descriptionCount: number;
  canonicalUrl: string | null;
  canonicalCount: number;
  h1: string | null;
  h1Count: number;
  headings: Array<{ level: number; text: string }>;
  robotsDirectives: string[];
  viewport: string | null;
  hreflangCount: number;
  structuredDataTypes: string[];
  structuredDataErrorCount: number;
  wordCount: number;
  textHash: string | null;
  imageCount: number;
  imagesWithoutAlt: number;
  outboundInternalLinkCount: number;
  redirectChain: string[];
  mixedContentCount: number;
  errorMessage: string | null;
  links: PageLink[];
}

export function createFailedPage(input: {
  requestedUrl: string;
  depth: number;
  statusCode?: number;
  contentType?: string;
  redirectChain?: string[];
  errorMessage: string;
  finalUrl?: string;
}): PageSnapshot {
  return {
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl ?? input.requestedUrl,
    depth: input.depth,
    statusCode: input.statusCode ?? 0,
    contentType: input.contentType ?? "",
    htmlBytes: 0,
    title: null,
    titleCount: 0,
    metaDescription: null,
    descriptionCount: 0,
    canonicalUrl: null,
    canonicalCount: 0,
    h1: null,
    h1Count: 0,
    headings: [],
    robotsDirectives: [],
    viewport: null,
    hreflangCount: 0,
    structuredDataTypes: [],
    structuredDataErrorCount: 0,
    wordCount: 0,
    textHash: null,
    imageCount: 0,
    imagesWithoutAlt: 0,
    outboundInternalLinkCount: 0,
    redirectChain: input.redirectChain ?? [],
    mixedContentCount: 0,
    errorMessage: input.errorMessage,
    links: []
  };
}

export function parseHtmlPage(input: {
  html: string;
  requestedUrl: string;
  finalUrl: string;
  depth: number;
  statusCode: number;
  contentType: string;
  redirectChain: string[];
  allowedHosts: string[];
}): PageSnapshot {
  const $ = cheerio.load(input.html);
  const titleElements = $("title");
  const descriptions = $("meta[name='description']");
  const canonicals = $("link[rel~='canonical']");
  const h1Elements = $("h1");
  const title = cleanText(titleElements.first().text()) || null;
  const metaDescription = cleanText(descriptions.first().attr("content") ?? "") || null;
  const canonicalRaw = canonicals.first().attr("href")?.trim() ?? null;
  const headings = $("h1,h2,h3,h4,h5,h6").toArray().map((element) => ({
    level: Number(element.tagName.slice(1)),
    text: cleanText($(element).text())
  })).filter((heading) => heading.text.length > 0).slice(0, 250);
  const robotsDirectives = new Set<string>();
  $("meta[name='robots'],meta[name='googlebot']").each((_, element) => {
    const content = $(element).attr("content") ?? "";
    for (const directive of content.split(",")) {
      const normalized = directive.trim().toLowerCase();
      if (normalized) robotsDirectives.add(normalized);
    }
  });

  const structuredDataTypes = new Set<string>();
  let structuredDataErrorCount = 0;
  $("script[type='application/ld+json']").each((_, element) => {
    const source = $(element).contents().text().trim();
    if (!source) return;
    try {
      collectSchemaTypes(JSON.parse(source) as unknown, structuredDataTypes);
    } catch {
      structuredDataErrorCount += 1;
    }
  });

  const images = $("img").toArray();
  const imagesWithoutAlt = images.filter((image) => !($(image).attr("alt") ?? "").trim()).length;
  const allowed = new Set(input.allowedHosts.map((host) => host.toLowerCase()));
  const links: PageLink[] = [];
  const seenLinks = new Set<string>();
  $("a[href]").each((_, element) => {
    if (links.length >= 2_000) return;
    const rawHref = ($(element).attr("href") ?? "").trim();
    if (!rawHref || /^(#|mailto:|tel:|javascript:|data:)/i.test(rawHref)) return;
    try {
      const target = new URL(rawHref, input.finalUrl);
      if (target.protocol !== "http:" && target.protocol !== "https:") return;
      target.hash = "";
      for (const key of [...target.searchParams.keys()]) {
        if (/^(utm_.+|gclid|fbclid|_ga|mc_cid|mc_eid)$/i.test(key)) target.searchParams.delete(key);
      }
      const targetUrl = target.toString();
      if (seenLinks.has(targetUrl)) return;
      seenLinks.add(targetUrl);
      const rel = ($(element).attr("rel") ?? "").trim().toLowerCase() || null;
      links.push({
        targetUrl,
        anchorText: cleanText($(element).text()).slice(0, 500),
        linkType: allowed.has(target.hostname.toLowerCase()) ? "internal" : "external",
        rel
      });
    } catch {
      // Ignore malformed hrefs; the page itself remains analyzable.
    }
  });

  const body = $("body");
  body.find("script,style,noscript,template,svg,iframe").remove();
  const text = cleanText(body.text());
  const words = text.match(/[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu) ?? [];
  const insecureAttributes = ["src", "href", "poster"].flatMap((attribute) => {
    return $(`[${attribute}]`).toArray().map((element) => $(element).attr(attribute) ?? "");
  }).filter((value) => value.startsWith("http://")).length;

  let canonicalUrl: string | null = null;
  if (canonicalRaw) {
    try { canonicalUrl = new URL(canonicalRaw, input.finalUrl).toString(); } catch { canonicalUrl = canonicalRaw; }
  }

  return {
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    depth: input.depth,
    statusCode: input.statusCode,
    contentType: input.contentType,
    htmlBytes: Buffer.byteLength(input.html, "utf8"),
    title,
    titleCount: titleElements.length,
    metaDescription,
    descriptionCount: descriptions.length,
    canonicalUrl,
    canonicalCount: canonicals.length,
    h1: cleanText(h1Elements.first().text()) || null,
    h1Count: h1Elements.length,
    headings,
    robotsDirectives: [...robotsDirectives],
    viewport: $("meta[name='viewport']").first().attr("content")?.trim() || null,
    hreflangCount: $("link[rel~='alternate'][hreflang]").length,
    structuredDataTypes: [...structuredDataTypes].slice(0, 50),
    structuredDataErrorCount,
    wordCount: words.length,
    textHash: text ? createHash("sha256").update(text.toLowerCase()).digest("hex") : null,
    imageCount: images.length,
    imagesWithoutAlt,
    outboundInternalLinkCount: links.filter((link) => link.linkType === "internal").length,
    redirectChain: input.redirectChain,
    mixedContentCount: insecureAttributes,
    errorMessage: null,
    links
  };
}

function collectSchemaTypes(value: unknown, result: Set<string>) {
  if (Array.isArray(value)) {
    for (const entry of value) collectSchemaTypes(entry, result);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const type = record["@type"];
  if (typeof type === "string") result.add(type.slice(0, 100));
  else if (Array.isArray(type)) for (const item of type) if (typeof item === "string") result.add(item.slice(0, 100));
  if (record["@graph"]) collectSchemaTypes(record["@graph"], result);
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
