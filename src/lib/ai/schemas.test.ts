import { describe, expect, it } from "vitest";
import { seoRecommendationSchema } from "@/lib/ai/schemas";

describe("AI structured output contract", () => {
  it("accepts bounded recommendation proposals", () => {
    const result = seoRecommendationSchema.parse({
      summary: "The page is missing a search description.",
      titleSuggestions: [{ title: "A helpful title", rationale: "The crawl found an H1 about the same subject." }],
      metaDescription: "A concise page-specific summary.",
      recommendedHeadings: [{ level: 2, text: "What readers need to know" }],
      actions: [{ action: "Add a unique description.", evidence: "The latest crawl found no meta description.", priority: "medium" }],
      caveats: ["No analytics data was provided."]
    });
    expect(result.titleSuggestions).toHaveLength(1);
  });

  it("rejects invented fields and malformed structured output", () => {
    expect(() => seoRecommendationSchema.parse({ summary: "ok", fabricatedSearchVolume: 9000 })).toThrow();
    expect(() => seoRecommendationSchema.parse({ summary: "", titleSuggestions: [], metaDescription: null, recommendedHeadings: [], actions: [], caveats: [] })).toThrow();
  });
});
