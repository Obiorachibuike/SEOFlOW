import { describe, expect, it } from "vitest";
import { HttpError, readJson } from "@/lib/http";

function post(body: BodyInit, headers: HeadersInit = {}) {
  return new Request("https://app.example/api", { method: "POST", headers, body });
}

describe("bounded JSON request parsing", () => {
  it("parses valid UTF-8 JSON", async () => {
    await expect(readJson(post(JSON.stringify({ message: "café" })), 100)).resolves.toEqual({ message: "café" });
  });

  it("rejects an oversized content length before reading", async () => {
    await expect(readJson(post("{}", { "content-length": "1000" }), 10)).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("enforces its byte cap when content length is absent or dishonest", async () => {
    await expect(readJson(post(JSON.stringify({ body: "x".repeat(30) })), 10)).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects malformed JSON and invalid UTF-8 with bounded client errors", async () => {
    await expect(readJson(post("{broken"))).rejects.toMatchObject({ status: 400, code: "INVALID_JSON" });
    const invalidUtf8 = new Uint8Array([0xc3, 0x28]);
    await expect(readJson(post(invalidUtf8))).rejects.toBeInstanceOf(HttpError);
  });
});
