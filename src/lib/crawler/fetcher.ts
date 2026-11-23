import { Agent, fetch as undiciFetch } from "undici";
import { createPinnedDispatcher, validatePublicDestination } from "@/lib/crawler/ssrf";

export interface SafeFetchResult {
  statusCode: number;
  finalUrl: string;
  contentType: string;
  body: string;
  redirectChain: string[];
}

export class CrawlFetchError extends Error {
  constructor(message: string, public readonly statusCode?: number) {
    super(message);
    this.name = "CrawlFetchError";
  }
}

const maxRedirects = 6;

export async function safeFetchText(
  input: string,
  options: { accept?: string; maxBytes?: number; timeoutMs?: number; allowedHosts?: string[] } = {}
): Promise<SafeFetchResult> {
  const maxBytes = options.maxBytes ?? Number(process.env.CRAWL_MAX_RESPONSE_BYTES ?? 2_097_152);
  const timeoutMs = options.timeoutMs ?? Number(process.env.CRAWL_REQUEST_TIMEOUT_MS ?? 12_000);
  const allowedHosts = options.allowedHosts?.map((host) => host.toLowerCase());
  const start = await validatePublicDestination(input);
  let current = start.url;
  const seen = new Set<string>();
  const redirectChain: string[] = [];

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const normalized = current.toString();
    if (seen.has(normalized)) throw new CrawlFetchError("The server returned a redirect loop.");
    seen.add(normalized);

    const destination = hop === 0 ? start : await validatePublicDestination(current);
    const hostname = destination.hostname.toLowerCase();
    if (allowedHosts && !allowedHosts.includes(hostname)) {
      throw new CrawlFetchError("The page redirected outside the approved website host.");
    }
    const dispatcher = createPinnedDispatcher(destination.hostname, destination.addresses);
    let response: Awaited<ReturnType<typeof undiciFetch>> | undefined;
    try {
      response = await undiciFetch(current, {
        method: "GET",
        redirect: "manual",
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          "user-agent": process.env.CRAWL_USER_AGENT ?? "SEOFlowBot/1.0 (+https://example.com/crawler)",
          accept: options.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1",
          "accept-encoding": "gzip, deflate, br"
        }
      });

      const statusCode = response.status;
      const location = response.headers.get("location");
      if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
        await response.body?.cancel().catch(() => undefined);
        if (hop === maxRedirects) throw new CrawlFetchError("The page exceeded the redirect limit.", statusCode);
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new CrawlFetchError("The server returned an invalid redirect location.", statusCode);
        }
        // Validate before following, even if it will later be rejected as out-of-scope.
        const safeNext = await validatePublicDestination(next);
        if (allowedHosts && !allowedHosts.includes(safeNext.hostname.toLowerCase())) {
          throw new CrawlFetchError("The page redirected outside the approved website host.", statusCode);
        }
        redirectChain.push(current.toString());
        current = safeNext.url;
        continue;
      }

      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        throw new CrawlFetchError(`The response is larger than the ${maxBytes} byte crawl limit.`, statusCode);
      }
      const body = await readBody(response, maxBytes);
      return {
        statusCode,
        finalUrl: current.toString(),
        contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(),
        body,
        redirectChain
      };
    } catch (error) {
      if (error instanceof CrawlFetchError) throw error;
      const message = error instanceof Error && error.name === "TimeoutError"
        ? `The request timed out after ${timeoutMs} ms.`
        : "The page could not be fetched safely.";
      throw new CrawlFetchError(message);
    } finally {
      await (dispatcher as Agent).close().catch(() => undefined);
    }
  }
  throw new CrawlFetchError("The page could not be fetched.");
}

async function readBody(response: Awaited<ReturnType<typeof undiciFetch>>, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new CrawlFetchError(`The response is larger than the ${maxBytes} byte crawl limit.`, response.status);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total).toString("utf8");
}
