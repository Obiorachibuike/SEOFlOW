import { describe, expect, it } from "vitest";
import { backlinkSummarySchema, competitorItemSchema, keywordOverviewItemSchema, normalizeSearchLanguage, normalizeSearchLocation } from "@/lib/seo-data/dataforseo";

describe("provider-sourced SEO data validation", () => {
  it("accepts only bounded keyword metrics with a source keyword", () => {
    expect(keywordOverviewItemSchema.parse({
      keyword_data: { keyword: "technical SEO", keyword_info: { search_volume: 880, cpc: 2.35 } },
      keyword_properties: { keyword_difficulty: 41 }
    })).toMatchObject({ keyword_data: { keyword_info: { search_volume: 880, cpc: 2.35 } }, keyword_properties: { keyword_difficulty: 41 } });
    expect(keywordOverviewItemSchema.parse({ keyword: "technical SEO", keyword_info: { search_volume: 880, cpc: 2.35 }, keyword_properties: { keyword_difficulty: 41 } })).toMatchObject({ keyword_data: { keyword: "technical SEO", keyword_info: { search_volume: 880 } }, keyword_properties: { keyword_difficulty: 41 } });
    expect(keywordOverviewItemSchema.safeParse({ keyword_data: { keyword: "x", keyword_info: { search_volume: -3 } } }).success).toBe(false);
    expect(keywordOverviewItemSchema.safeParse({ keyword_data: { keyword: "x" }, keyword_properties: { keyword_difficulty: 140 } }).success).toBe(false);
  });

  it("rejects impossible backlink counts and malformed competitor records", () => {
    expect(backlinkSummarySchema.parse({ backlinks: 1000, referring_domains: 72 })).toMatchObject({ backlinks: 1000 });
    expect(backlinkSummarySchema.safeParse({ backlinks: -1 }).success).toBe(false);
    expect(competitorItemSchema.parse({ domain: "competitor.example", intersections: 12, avg_position: 14.5 })).toMatchObject({ competitor_domain: "competitor.example", intersections: 12 });
    expect(competitorItemSchema.parse({ competitor_domain: "legacy.example", intersections: 2 })).toMatchObject({ competitor_domain: "legacy.example" });
    expect(competitorItemSchema.safeParse({ domain: "", intersections: -2 }).success).toBe(false);
  });

  it("requires a real country and normalizes only the language code", () => {
    expect(normalizeSearchLocation("NG")).toBe("Nigeria");
    expect(normalizeSearchLocation("GB")).toBe("United Kingdom");
    expect(normalizeSearchLanguage("en-GB")).toBe("en");
    expect(() => normalizeSearchLocation("")).toThrow(/country/);
    expect(() => normalizeSearchLanguage("not a language")).toThrow(/language code/);
  });
});
