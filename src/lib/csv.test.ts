import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv";

describe("CSV cells", () => {
  it("quotes delimiters and doubles embedded quotes", () => {
    expect(csvCell('audit, "finding"')).toBe('"audit, ""finding"""');
  });

  it("neutralizes formula-like user strings after leading whitespace", () => {
    expect(csvCell("=1+1")).toBe('"\'=1+1"');
    expect(csvCell(" \t@SUM(A1:A2)")).toBe('"\' \t@SUM(A1:A2)"');
  });

  it("preserves numeric values and represents empty cells safely", () => {
    expect(csvCell(-12)).toBe('"-12"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });
});
