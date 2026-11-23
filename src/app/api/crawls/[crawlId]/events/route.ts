import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { auditReports, crawlJobs } from "@/db/schema";
import { requireProject } from "@/lib/authz";
import { HttpError, jsonError } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ crawlId: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new HttpError(401, "Sign in to continue.", "UNAUTHENTICATED");
    const { crawlId } = await context.params;
    const [row] = await db.select({ crawl: crawlJobs, report: auditReports })
      .from(crawlJobs)
      .leftJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
      .where(eq(crawlJobs.id, crawlId)).limit(1);
    if (!row) throw new HttpError(404, "Crawl not found.", "CRAWL_NOT_FOUND");
    await requireProject(row.crawl.projectId, session.user.id);

    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const poll = async () => {
          try {
            while (!closed && !request.signal.aborted) {
              const [current] = await db.select({ crawl: crawlJobs, report: auditReports })
                .from(crawlJobs)
                .leftJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
                .where(eq(crawlJobs.id, crawlId)).limit(1);
              if (!current) break;
              const payload = {
                id: current.crawl.id,
                status: current.crawl.status,
                pagesDiscovered: current.crawl.pagesDiscovered,
                pagesProcessed: current.crawl.pagesProcessed,
                currentUrl: current.crawl.currentUrl,
                errorMessage: current.crawl.errorMessage,
                report: current.report
              };
              controller.enqueue(encoder.encode(`event: progress\ndata: ${JSON.stringify(payload)}\n\n`));
              if (["completed", "failed", "cancelled"].includes(current.crawl.status)) break;
              await new Promise((resolve) => setTimeout(resolve, 1_500));
            }
          } catch (error) {
            if (!closed) controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "Progress stream temporarily unavailable." })}\n\n`));
            console.error("Crawl SSE polling failed", error);
          } finally {
            if (!closed) {
              closed = true;
              controller.close();
            }
          }
        };
        void poll();
      },
      cancel() { closed = true; }
    });
    request.signal.addEventListener("abort", () => { closed = true; }, { once: true });
    return new Response(stream, { headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    } });
  } catch (error) { return jsonError(error); }
}
