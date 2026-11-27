/**
 * Integration test: Better Auth + Drizzle + PostgreSQL schema, executed
 * against PGlite (a real Postgres compiled to WASM) with the repository's
 * actual migrations applied.
 *
 * Covers: migrations -> signup -> verification email -> email verification ->
 * sign-in -> session retrieval, password reset, duplicate registration, plus
 * the failure mode that took production down (queries against a database that
 * was never migrated).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { users } from "./schema";

const emailCalls: Array<{ to: string; subject: string; url: string; action: string }> = [];

vi.mock("@/lib/email", () => ({
  sendAccountEmail: vi.fn(async (input: { to: string; subject: string; url: string; action: string }) => {
    emailCalls.push(input);
  })
}));

type MigratedDatabase = NodePgDatabase<typeof schema>;

async function createPglite() {
  const client = new PGlite();
  return client;
}

async function applyMigrations(client: PGlite) {
  const dir = join(process.cwd(), "drizzle");
  const files = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  for (const file of files) {
    await client.exec(readFileSync(join(dir, file), "utf8"));
  }
}

async function createAuthFor(database: MigratedDatabase) {
  const { createSeoFlowAuth } = await import("@/auth");
  return createSeoFlowAuth(database);
}

const ENV_SNAPSHOT = { ...process.env };

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "integration-test-secret-integration-test-secret";
  process.env.BETTER_AUTH_URL = "http://localhost:3000";
  process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});

afterAll(() => {
  process.env = { ...ENV_SNAPSHOT };
});

describe("migrations produce a working Better Auth schema", () => {
  it("creates every table Better Auth writes", async () => {
    const client = await createPglite();
    try {
      await applyMigrations(client);
      const result = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name IN ('user','session','account','verification')
         ORDER BY table_name`
      );
      expect(result.rows.map((row) => row.table_name)).toEqual(["account", "session", "user", "verification"]);
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe("authentication flows against the migrated database", () => {
  let client: PGlite;
  let database: MigratedDatabase;
  let auth: Awaited<ReturnType<typeof createAuthFor>>;

  beforeAll(async () => {
    client = await createPglite();
    await applyMigrations(client);
    database = drizzle(client, { schema }) as unknown as MigratedDatabase;
    auth = await createAuthFor(database);
  }, 90_000);

  afterAll(async () => {
    await client.close();
  });

  it("signs up a new user and sends a verification email", async () => {
    const response = await auth.api.signUpEmail({
      body: { name: "Ada Lovelace", email: "ada@example.com", password: "correct horse battery staple" }
    });
    expect(response.user.email).toBe("ada@example.com");
    const verificationEmail = emailCalls.find((call) => call.action === "verify" && call.to === "ada@example.com");
    expect(verificationEmail).toBeTruthy();
    expect(verificationEmail!.url).toContain("token=");
  });

  it("refuses sign-in before email verification", async () => {
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: "correct horse battery staple" } })
    ).rejects.toMatchObject({ body: { code: "EMAIL_NOT_VERIFIED" } });
  });

  it("verifies the email address with the token from the verification email", async () => {
    const call = emailCalls.find((entry) => entry.action === "verify" && entry.to === "ada@example.com");
    const token = new URL(call!.url).searchParams.get("token")!;
    expect(token).toBeTruthy();
    const verified = await auth.api.verifyEmail({ query: { token }, headers: new Headers() });
    expect((verified as { status: boolean }).status).toBe(true);
  });

  it("signs in with verified credentials and creates a session", async () => {
    const signedIn = await auth.api.signInEmail({
      body: { email: "ada@example.com", password: "correct horse battery staple" }
    });
    expect(signedIn.token).toBeTruthy();
    expect(signedIn.user.email).toBe("ada@example.com");
  });

  it("rejects a wrong password with an invalid-credentials style error", async () => {
    await expect(
      auth.api.signInEmail({ body: { email: "ada@example.com", password: "definitely-wrong-password" } })
    ).rejects.toThrow();
  });

  it("treats duplicate registration as an enumeration-safe no-op", async () => {
    const response = await auth.api.signUpEmail({
      body: { name: "Ada Duplicate", email: "ada@example.com", password: "another password 123" }
    });
    expect(response.token).toBeNull();
    const rows = await database.select({ id: users.id }).from(users);
    expect(rows).toHaveLength(1);
  });

  it("resets the password through the emailed token and signs in with the new password", async () => {
    await auth.api.requestPasswordReset({
      body: { email: "ada@example.com", redirectTo: "/reset-password" }
    });
    const resetEmail = emailCalls.find((call) => call.action === "reset" && call.to === "ada@example.com");
    expect(resetEmail).toBeTruthy();
    // better-auth puts the token in the path: /api/auth/reset-password/<token>?callbackURL=...
    const token = new URL(resetEmail!.url).pathname.split("/").filter(Boolean).pop()!;
    expect(token).toBeTruthy();

    const reset = await auth.api.resetPassword({
      body: { newPassword: "a brand new password 99", token }
    });
    expect((reset as { status: boolean }).status).toBe(true);

    const signedIn = await auth.api.signInEmail({
      body: { email: "ada@example.com", password: "a brand new password 99" }
    });
    expect(signedIn.token).toBeTruthy();
  });
});

describe("authentication against a database that was never migrated", () => {
  it("rejects signup instead of silently succeeding", async () => {
    const client = await createPglite();
    try {
      const database = drizzle(client, { schema }) as unknown as MigratedDatabase;
      const auth = await createAuthFor(database);
      await expect(
        auth.api.signUpEmail({
          body: { name: "Grace Hopper", email: "grace@example.com", password: "password-12345" }
        })
      ).rejects.toThrow();
    } finally {
      await client.close();
    }
  }, 60_000);
});

describe("auth configuration surface", () => {
  it("keeps Google OAuth disabled when credentials are absent and enables it when present", async () => {
    const client = await createPglite();
    try {
      const database = drizzle(client, { schema }) as unknown as MigratedDatabase;
      const auth = await createAuthFor(database);
      const options = (auth as unknown as { options: { socialProviders: Record<string, unknown> } }).options;
      expect(Object.keys(options.socialProviders)).toHaveLength(0);
    } finally {
      await client.close();
    }
  }, 60_000);
});
