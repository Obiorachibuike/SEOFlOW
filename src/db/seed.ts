import "dotenv/config";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { plans, users } from "@/db/schema";

const defaultPlans = [
  { slug: "free", name: "Free", priceMonthly: "0", currency: "USD", crawlPageLimit: 100, projectLimit: 1, trackedKeywordLimit: 25, aiCredits: 20, features: ["1 project", "100 pages per crawl", "25 tracked keywords", "20 AI credits"] },
  { slug: "starter", name: "Starter", priceMonthly: "19", currency: "USD", crawlPageLimit: 1_000, projectLimit: 3, trackedKeywordLimit: 250, aiCredits: 250, features: ["3 projects", "1,000 pages per crawl", "250 tracked keywords", "250 AI credits"] },
  { slug: "pro", name: "Pro", priceMonthly: "59", currency: "USD", crawlPageLimit: 5_000, projectLimit: 10, trackedKeywordLimit: 2_000, aiCredits: 2_000, features: ["10 projects", "5,000 pages per crawl", "2,000 tracked keywords", "2,000 AI credits"] },
  { slug: "agency", name: "Agency", priceMonthly: "199", currency: "USD", crawlPageLimit: 10_000, projectLimit: 100, trackedKeywordLimit: 20_000, aiCredits: 20_000, features: ["100 projects", "10,000 pages per crawl", "20,000 tracked keywords", "White-label report capability available after setup"] }
];

async function seed() {
  for (const plan of defaultPlans) {
    await db.insert(plans).values(plan).onConflictDoUpdate({
      target: plans.slug,
      set: {
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        crawlPageLimit: plan.crawlPageLimit,
        projectLimit: plan.projectLimit,
        trackedKeywordLimit: plan.trackedKeywordLimit,
        aiCredits: plan.aiCredits,
        features: plan.features,
        updatedAt: new Date()
      }
    });
  }
  if (process.env.ADMIN_EMAIL) {
    await db.update(users).set({ platformRole: "super_admin" }).where(eq(users.email, process.env.ADMIN_EMAIL.toLowerCase()));
    console.info(`Applied initial super-admin role for ${process.env.ADMIN_EMAIL.toLowerCase()} if that account exists.`);
  }
  console.info(`Seeded ${defaultPlans.length} configurable subscription plans.`);
}

seed().catch((error: unknown) => {
  console.error("Plan seeding failed", error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
