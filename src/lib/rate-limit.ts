import { createHash } from "node:crypto";
import { lte, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { rateLimitBuckets } from "@/db/schema";

// Persisted in Postgres so limits are shared between independently deployed web instances.
const limit = Math.max(10, Number(process.env.API_RATE_LIMIT_PER_MINUTE ?? 60));
let lastCleanupAt = 0;

export async function rateLimit(key: string, perMinute = limit) {
  const maxRequests = Math.max(1, Math.min(1_000, Math.floor(perMinute)));
  const now = new Date();
  const resetAt = new Date(now.getTime() + 60_000);
  const keyHash = createHash("sha256").update(key).digest("hex");
  const [bucket] = await db.insert(rateLimitBuckets).values({ keyHash, count: 1, resetAt })
    .onConflictDoUpdate({
      target: rateLimitBuckets.keyHash,
      set: {
        count: sql`CASE WHEN ${rateLimitBuckets.resetAt} <= ${now} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
        resetAt: sql`CASE WHEN ${rateLimitBuckets.resetAt} <= ${now} THEN ${resetAt} ELSE ${rateLimitBuckets.resetAt} END`
      }
    })
    .returning({ count: rateLimitBuckets.count });

  if (now.getTime() - lastCleanupAt > 5 * 60_000) {
    lastCleanupAt = now.getTime();
    void db.delete(rateLimitBuckets).where(lte(rateLimitBuckets.resetAt, now)).catch((error: unknown) => {
      console.warn("Rate limit bucket cleanup failed", error instanceof Error ? error.message : "database error");
    });
  }
  return (bucket?.count ?? maxRequests + 1) <= maxRequests;
}

export function rateLimitResponse() {
  return NextResponse.json({ error: "Rate limit exceeded. Try again shortly.", code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "60" } });
}
