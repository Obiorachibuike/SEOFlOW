import { z } from "zod";

export const seoRecommendationSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  titleSuggestions: z.array(z.object({ title: z.string().trim().min(1).max(120), rationale: z.string().trim().min(1).max(500) }).strict()).max(5),
  metaDescription: z.string().trim().max(320).nullable(),
  recommendedHeadings: z.array(z.object({ level: z.number().int().min(1).max(6), text: z.string().trim().min(1).max(180) }).strict()).max(20),
  actions: z.array(z.object({ action: z.string().trim().min(1).max(300), evidence: z.string().trim().max(400), priority: z.enum(["high", "medium", "low"]) }).strict()).max(10),
  caveats: z.array(z.string().trim().max(300)).max(5)
}).strict();

export type SeoRecommendation = z.infer<typeof seoRecommendationSchema>;
