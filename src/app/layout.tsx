import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "SEOFlow — Discover. Optimize. Rank.", template: "%s · SEOFlow" },
  description: "An evidence-first SEO workspace for technical audits, thoughtful optimization and measurable progress.",
  applicationName: "SEOFlow",
  robots: { index: true, follow: true },
  openGraph: { title: "SEOFlow — Discover. Optimize. Rank.", description: "Evidence-first SEO, from crawl to improvement.", type: "website" }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark" suppressHydrationWarning><body>{children}</body></html>;
}
