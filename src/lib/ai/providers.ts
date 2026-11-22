import { Agent, fetch as undiciFetch } from "undici";
import type { LookupFunction } from "node:net";
import { validatePublicDestination } from "@/lib/crawler/ssrf";

export interface CompletionInput {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  system: string;
  user: string;
  timeoutMs?: number;
}

export interface CompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

export type CompletionAdapter = (input: CompletionInput) => Promise<CompletionResult>;

const adapters = new Map<string, CompletionAdapter>();

export function registerAiAdapter(name: string, adapter: CompletionAdapter) {
  adapters.set(name, adapter);
}

export async function completeWithProvider(adapterName: string, input: CompletionInput) {
  const adapter = adapters.get(adapterName);
  if (!adapter) throw new Error(`Unsupported AI provider adapter: ${adapterName}`);
  return adapter(input);
}

const compatibleChat: CompletionAdapter = async (input) => {
  const base = new URL(input.baseUrl);
  if (base.protocol !== "https:") throw new Error("AI provider endpoints must use HTTPS.");
  if (base.username || base.password || base.search || base.hash) throw new Error("AI provider base URLs cannot contain credentials, query parameters or fragments.");
  const root = base.toString().replace(/\/$/, "");
  const endpoint = root.endsWith("/chat/completions") ? root : `${root}/chat/completions`;
  const destination = await validatePublicDestination(endpoint);
  const dispatcher = new Agent({
    connect: { lookup: pinnedLookup(destination.hostname, destination.addresses) },
    maxOrigins: 1,
    connections: 1,
    pipelining: 0,
    connectTimeout: 8_000,
    headersTimeout: 30_000,
    bodyTimeout: 30_000,
    maxResponseSize: 1_000_000
  });
  try {
    const response = await undiciFetch(destination.url, {
      method: "POST",
      redirect: "error",
      dispatcher,
      signal: AbortSignal.timeout(input.timeoutMs ?? 45_000),
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model: input.modelId,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user }
        ],
        temperature: 0.3,
        max_tokens: 1_400
      })
    });
    const text = await response.text();
    if (text.length > 1_000_000) throw new Error("AI provider response exceeded the size limit.");
    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}.`);
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw new Error("AI provider returned invalid JSON."); }
    const data = payload as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("AI provider response did not contain a text completion.");
    return {
      content,
      inputTokens: safeTokenCount(data.usage?.prompt_tokens ?? data.usage?.input_tokens),
      outputTokens: safeTokenCount(data.usage?.completion_tokens ?? data.usage?.output_tokens)
    };
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
};

for (const adapter of ["agnes-openai-compatible", "openai-compatible", "huggingface-chat-compatible"]) {
  registerAiAdapter(adapter, compatibleChat);
}

function safeTokenCount(value: number | undefined) {
  return Number.isSafeInteger(value) && value! >= 0 ? value! : 0;
}

function pinnedLookup(hostname: string, addresses: Array<{ address: string; family: number }>): LookupFunction {
  const expected = hostname.toLowerCase().replace(/\.$/, "");
  return (requestedHost, options, callback) => {
    if (requestedHost.toLowerCase().replace(/\.$/, "") !== expected) {
      const error = Object.assign(new Error("Unexpected provider DNS hostname."), { code: "ENOTFOUND" });
      callback(error, "", 0);
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  };
}
