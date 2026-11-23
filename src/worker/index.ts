import "dotenv/config";
import { pool } from "@/db";
import { registerCrawlWorker } from "@/worker/crawl-worker";

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to start the SEOFlow worker.");
  const boss = await registerCrawlWorker();
  console.info("SEOFlow worker is running; queue: seo-site-crawl");
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.info(`Received ${signal}; draining SEOFlow worker.`);
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      await pool.end();
      process.exit(0);
    } catch (error) {
      console.error("Worker shutdown failed", error);
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  boss.on("error", (error) => console.error("pg-boss worker error", error));
}

main().catch((error: unknown) => {
  console.error("SEOFlow worker failed to start", error);
  process.exit(1);
});
