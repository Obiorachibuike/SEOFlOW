import { describe, expect, it } from "vitest";
import { createAuditPdf } from "@/lib/reports/pdf";

describe("audit PDF export", () => {
  it("creates a valid PDF header, cross-reference and methodology note", () => {
    const pdf = createAuditPdf({
      project: { name: "Test Site", websiteUrl: "https://example.com" },
      crawl: { pagesProcessed: 2, finishedAt: new Date("2026-11-22T00:00:00Z") },
      report: { overallScore: 82, scoreMethodologyVersion: "2026.1", categoryScores: { technical: 90, on_page: 80, content: 100, internal_links: 90, performance: null, structured_data: null } },
      issues: [{ severity: "high", category: "on_page", description: "Missing meta description", url: "https://example.com/page", recommendation: "Add an accurate page-specific summary." }]
    });
    const output = pdf.toString("ascii");
    expect(output.startsWith("%PDF-1.4")).toBe(true);
    expect(output).toContain("xref");
    expect(output).toContain("startxref");
    expect(output).toContain("%%EOF");
    expect(output).toContain("SEOFlow");
    expect(output).toContain("82/100");
    expect(output).toContain("2026.1");
  });

  it("paginates larger reports rather than clipping findings", () => {
    const issues = Array.from({ length: 90 }, (_, index) => ({ severity: index % 2 ? "medium" : "high", category: "on_page", description: `Issue ${index} with enough words to check page wrapping and layout.`, url: `https://example.com/page/${index}`, recommendation: "Review the affected page and apply the suggested change where appropriate." }));
    const output = createAuditPdf({
      project: { name: "Large report", websiteUrl: "https://example.com" },
      crawl: { pagesProcessed: 90, finishedAt: null },
      report: { overallScore: 50, scoreMethodologyVersion: "2026.1", categoryScores: { technical: 60, on_page: 50, content: 70, internal_links: 80, performance: null, structured_data: null } },
      issues
    }).toString("ascii");
    expect((output.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    expect(output).toContain("Issue 89");
  });
});
