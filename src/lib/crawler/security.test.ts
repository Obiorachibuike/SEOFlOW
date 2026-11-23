import { describe, expect, it } from "vitest";
import { isPublicIp, parseSafeHttpUrl, validatePublicDestination } from "@/lib/crawler/ssrf";
import { UnsafeUrlError } from "@/lib/crawler/ssrf";

describe("crawler URL safety", () => {
  it.each([
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.20.0.1",
    "192.168.1.2", "192.0.2.4", "198.18.0.1", "203.0.113.9", "224.0.0.1",
    "::", "::1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1"
  ])("rejects non-public address %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) ("allows public address %s", (address) => {
    expect(isPublicIp(address)).toBe(true);
  });

  it("accepts only standard HTTP(S) URLs without credentials or custom ports", () => {
    expect(parseSafeHttpUrl("https://example.com/page").hostname).toBe("example.com");
    expect(() => parseSafeHttpUrl("file:///etc/passwd")).toThrow(UnsafeUrlError);
    expect(() => parseSafeHttpUrl("https://user:pass@example.com")).toThrow(/credentials/);
    expect(() => parseSafeHttpUrl("https://example.com:8443")).toThrow(/ports/);
    expect(() => parseSafeHttpUrl("http://localhost")).toThrow(/publicly routable/);
  });

  it("rejects a private literal destination before any network request", async () => {
    await expect(validatePublicDestination("http://127.0.0.1/metadata")).rejects.toThrow(/non-public/);
    await expect(validatePublicDestination("http://[::1]/")).rejects.toThrow(/non-public/);
  });
});
