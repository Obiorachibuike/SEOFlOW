import { PgBoss } from "pg-boss";

const CRAWL_QUEUE = "seo-site-crawl";
let bossPromise: Promise<PgBoss> | null = null;

export async function getBoss() {
  if (!process.env.DATABASE_URL && process.env.NODE_ENV === "production") {
    throw new Error("DATABASE_URL is required to use the persistent job queue.");
  }
  if (!bossPromise) {
    bossPromise = (async () => {
      const boss = new PgBoss({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/seoflow", application_name: "seoflow-web" });
      boss.on("error", (error) => console.error("pg-boss producer error", error));
      await boss.start();
      await boss.createQueue(CRAWL_QUEUE, {
        retryLimit: 3,
        retryDelay: 15,
        retryBackoff: true,
        retryDelayMax: 900,
        expireInSeconds: 3_600,
        heartbeatSeconds: 30,
        deleteAfterSeconds: 2_592_000,
        deadLetter: "seo-site-crawl-dead"
      });
      await boss.createQueue("seo-site-crawl-dead", { deleteAfterSeconds: 7_776_000 });
      return boss;
    })().catch((error) => {
      bossPromise = null;
      throw error;
    });
  }
  return bossPromise;
}

export async function enqueueCrawl(data: { crawlId: string; projectId: string }) {
  const boss = await getBoss();
  return boss.send(CRAWL_QUEUE, data, {
    singletonKey: data.crawlId,
    retryLimit: 3,
    retryDelay: 15,
    retryBackoff: true,
    retryDelayMax: 900,
    expireInSeconds: 3_600,
    group: { id: data.projectId }
  });
}

export { CRAWL_QUEUE };
