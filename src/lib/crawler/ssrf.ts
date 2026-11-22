import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent } from "undici";

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export function isPublicIp(address: string) {
  if (!ipaddr.isValid(address)) return false;
  try {
    // process() maps IPv4-mapped IPv6 back to IPv4 before checking its range.
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function parseSafeHttpUrl(input: string | URL) {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  } catch {
    throw new UnsafeUrlError("The URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only HTTP and HTTPS URLs are allowed.");
  if (url.username || url.password) throw new UnsafeUrlError("URLs containing credentials are not allowed.");
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) throw new UnsafeUrlError("Non-standard ports are not allowed.");
  const hostname = unbracket(url.hostname).replace(/\.$/, "").toLowerCase();
  if (!hostname || /(^|\.)(localhost|local|internal|test|invalid|example)$/i.test(hostname)) {
    throw new UnsafeUrlError("The destination host is not publicly routable.");
  }
  url.hostname = hostname;
  return url;
}

function unbracket(hostname: string) {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export async function validatePublicDestination(input: string | URL) {
  const url = parseSafeHttpUrl(input);
  const hostname = unbracket(url.hostname);
  let addresses: Array<{ address: string; family: number }>;
  if (isIP(hostname)) {
    addresses = [{ address: hostname, family: isIP(hostname) }];
  } else {
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new UnsafeUrlError("The destination host could not be resolved.");
    }
  }
  if (!addresses.length || addresses.some((entry) => !isPublicIp(entry.address))) {
    throw new UnsafeUrlError("The destination resolves to a non-public network address.");
  }
  return { url, hostname, addresses };
}

/**
 * Build an HTTP dispatcher pinned to the already-validated DNS answers. This prevents a
 * second DNS lookup at connect time from being rebound to a private address.
 */
export function createPinnedDispatcher(hostname: string, addresses: Array<{ address: string; family: number }>) {
  const expectedHost = unbracket(hostname).replace(/\.$/, "").toLowerCase();
  const pinnedLookup: LookupFunction = (requestedHost, options, callback) => {
    if (unbracket(requestedHost).replace(/\.$/, "").toLowerCase() !== expectedHost) {
      const error = Object.assign(new Error("Unexpected DNS hostname."), { code: "ENOTFOUND" });
      callback(error, "", 0);
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    const address = addresses[0];
    callback(null, address.address, address.family);
  };
  return new Agent({
    connect: { lookup: pinnedLookup },
    maxOrigins: 1,
    connections: 1,
    pipelining: 0,
    connectTimeout: 8_000,
    headersTimeout: 12_000,
    bodyTimeout: 12_000,
    maxResponseSize: Number(process.env.CRAWL_MAX_RESPONSE_BYTES ?? 2_097_152)
  });
}
