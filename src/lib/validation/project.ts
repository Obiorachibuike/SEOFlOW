import { z } from "zod";

export const createProjectSchema = z.object({
  websiteUrl: z.string().trim().min(3).max(2048).url(),
  name: z.string().trim().max(100).optional(),
  targetCountry: z.string().trim().length(2).toUpperCase().optional().or(z.literal("")),
  targetLanguage: z.string().trim().max(12).optional().or(z.literal("")),
  crawlPageLimit: z.number().int().min(1).max(10_000).optional()
}).strict();

export function normalizeWebsiteUrl(input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a complete website URL, such as https://example.com.");
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Only HTTP and HTTPS websites can be added.");
  if (url.username || url.password) throw new Error("Website URLs cannot include credentials.");
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) throw new Error("Custom website ports are not supported.");
  if (!url.hostname || /(^|\.)(localhost|local|internal|test|invalid|example)$/i.test(url.hostname)) {
    throw new Error("Enter a publicly reachable website domain.");
  }
  url.hash = "";
  url.search = "";
  if (!url.pathname) url.pathname = "/";
  return { websiteUrl: url.toString().replace(/\/$/, ""), host: url.hostname.toLowerCase() };
}
