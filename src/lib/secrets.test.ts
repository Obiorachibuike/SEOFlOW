import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "@/lib/secrets";

afterEach(() => { delete process.env.SECRETS_ENCRYPTION_KEY; });

describe("encrypted provider credentials", () => {
  it("encrypts with AES-GCM and round trips without storing plaintext", () => {
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
    const secret = "provider-token-do-not-log";
    const ciphertext = encryptSecret(secret);
    expect(ciphertext).not.toContain(secret);
    expect(ciphertext.startsWith("v1:")).toBe(true);
    expect(decryptSecret(ciphertext)).toBe(secret);
  });

  it("rejects a tampered credential ciphertext", () => {
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const encrypted = encryptSecret("sensitive-value");
    expect(() => decryptSecret(`${encrypted.slice(0, -1)}A`)).toThrow();
  });

  it("requires a valid 32-byte key", () => {
    process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(16).toString("base64");
    expect(() => encryptSecret("secret")).toThrow(/32-byte/);
  });
});
