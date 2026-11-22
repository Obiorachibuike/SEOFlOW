import { describe, expect, it } from "vitest";
import { normalizeWebsiteUrl } from "@/lib/validation/project";

describe("project website validation", () => {
  it("normalizes hostnames and removes URL fragments and query parameters", () => {
    expect(normalizeWebsiteUrl("https://example.com/path?utm_source=test#section")).toEqual({ websiteUrl: "https://example.com/path", host: "example.com" });
    expect(normalizeWebsiteUrl("http://www.example.com/")).toEqual({ websiteUrl: "http://www.example.com", host: "www.example.com" });
  });

  it.each(["javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com", "http://localhost:3000"]) (
    "rejects unsafe website URL %s", (input) => {
      expect(() => normalizeWebsiteUrl(input)).toThrow();
    }
  );
});
