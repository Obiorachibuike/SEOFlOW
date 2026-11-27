import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, classifyError } from "@/lib/errors";
import { logger, errorDiagnostics } from "@/lib/logger";

const DEFAULT_JSON_BODY_LIMIT = 1_048_576;

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = "REQUEST_FAILED") {
    super(message);
    this.name = "HttpError";
  }
}

export function jsonError(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: "The request did not pass validation.", issues: error.issues }, { status: 400 });
  }
  if (error instanceof AppError) {
    logger.error("API_REQUEST_FAILED", {
      operation: error.operation,
      code: error.code,
      referenceId: error.referenceId,
      statusCode: error.statusCode,
      ...errorDiagnostics(error)
    });
    return NextResponse.json(
      { error: error.message, code: error.code, referenceId: error.referenceId },
      { status: error.statusCode }
    );
  }
  const appError = classifyError(error, "http.unhandled");
  logger.error("API_REQUEST_FAILED", {
    operation: appError.operation,
    code: appError.code,
    referenceId: appError.referenceId,
    statusCode: appError.statusCode,
    ...errorDiagnostics(error)
  });
  return NextResponse.json(
    { error: "An unexpected error occurred.", code: appError.code, referenceId: appError.referenceId },
    { status: appError.statusCode }
  );
}

export async function readJson(request: Request, maxBytes = DEFAULT_JSON_BODY_LIMIT): Promise<unknown> {
  const text = await readTextBody(request, maxBytes);
  try { return JSON.parse(text) as unknown; }
  catch { throw new HttpError(400, "Request body must be valid JSON.", "INVALID_JSON"); }
}

export async function readTextBody(request: Request, maxBytes = DEFAULT_JSON_BODY_LIMIT): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    throw new HttpError(413, "Request body exceeds the allowed size.", "PAYLOAD_TOO_LARGE");
  }
  if (!request.body) throw new HttpError(400, "Request body is empty.", "EMPTY_BODY");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new HttpError(413, "Request body exceeds the allowed size.", "PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Request body could not be read.", "INVALID_BODY");
  } finally {
    reader.releaseLock();
  }

  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, totalBytes)); }
  catch { throw new HttpError(400, "Request body must be valid UTF-8.", "INVALID_ENCODING"); }
}
