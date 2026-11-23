export interface AuditPdfInput {
  project: { name: string; websiteUrl: string };
  crawl: { pagesProcessed: number; finishedAt: Date | null };
  report: { overallScore: number; categoryScores: Record<string, number | null>; scoreMethodologyVersion: string };
  issues: Array<{ severity: string; category: string; description: string; url: string; recommendation: string }>;
}

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 48;

/** Create a compact, searchable PDF using standard PDF fonts only (no runtime font/network access). */
export function createAuditPdf(input: AuditPdfInput) {
  const pages: string[] = [];
  let content = "";
  let y = PAGE_HEIGHT - MARGIN;
  const fill = (color: string) => { content += `${color} rg\n`; };
  const drawText = (text: string, x: number, baseline: number, size: number, color: string, bold = false) => {
    const safe = pdfText(text);
    fill(color);
    content += `BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm (${safe}) Tj ET\n`;
  };
  const drawRule = () => { content += `0.15 0.19 0.25 RG 0.5 w ${MARGIN} ${y.toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${y.toFixed(2)} l S\n`; };
  const newPage = () => {
    if (content) pages.push(content);
    content = "";
    y = PAGE_HEIGHT - MARGIN;
    content += `0.03 0.04 0.06 rg 0 ${PAGE_HEIGHT - 54} ${PAGE_WIDTH} 54 re f\n`;
    drawText("SEOFLOW  /  AUDIT REPORT", MARGIN, PAGE_HEIGHT - 34, 8, "0.22 1 0.08", true);
    drawText(input.project.name, MARGIN, PAGE_HEIGHT - 49, 10, "0.96 0.97 0.98", true);
    y = PAGE_HEIGHT - 78;
  };
  const ensure = (height: number) => { if (y - height < 56) newPage(); };
  const drawBlock = (value: string, x: number, width: number, size: number, color: string, bold = false, leading = size * 1.42) => {
    const lines = wrapPdfText(value, width, size);
    for (const line of lines) {
      ensure(leading);
      y -= leading;
      drawText(line, x, y, size, color, bold);
    }
    return lines.length * leading;
  };

  // Cover header.
  content += `0.03 0.04 0.06 rg 0 ${PAGE_HEIGHT - 128} ${PAGE_WIDTH} 128 re f\n`;
  drawText("SEOFLOW  /  AUDIT REPORT", MARGIN, PAGE_HEIGHT - 39, 9, "0.22 1 0.08", true);
  drawBlock(input.project.name, MARGIN, PAGE_WIDTH - MARGIN * 2, 22, "0.96 0.97 0.98", true, 29);
  drawBlock(input.project.websiteUrl, MARGIN, PAGE_WIDTH - MARGIN * 2, 8, "0.61 0.64 0.69", false, 11);
  y = PAGE_HEIGHT - 155;

  // Score card.
  content += `0.08 0.11 0.15 rg ${MARGIN} ${(y - 72).toFixed(2)} ${PAGE_WIDTH - MARGIN * 2} 72 re f\n`;
  drawText("OVERALL DIAGNOSTIC SCORE", MARGIN + 16, y - 20, 8, "0.61 0.64 0.69", true);
  drawText(`${input.report.overallScore}/100`, MARGIN + 16, y - 54, 26, "0.22 1 0.08", true);
  drawText(`${input.crawl.pagesProcessed} pages analyzed`, MARGIN + 185, y - 37, 9, "0.96 0.97 0.98");
  drawText(`Completed ${input.crawl.finishedAt?.toISOString() ?? "time unavailable"}`, MARGIN + 185, y - 54, 8, "0.61 0.64 0.69");
  y -= 100;
  drawBlock("This is SEOFlow’s internal diagnostic indicator—not a Google ranking score or a prediction of search position.", MARGIN, PAGE_WIDTH - MARGIN * 2, 8, "0.61 0.64 0.69");
  y -= 12;

  drawText("Score breakdown", MARGIN, y, 12, "0.96 0.97 0.98", true);
  y -= 12;
  const categoryLabels: Record<string, string> = { technical: "Technical SEO", on_page: "On-page SEO", content: "Content", performance: "Performance", internal_links: "Internal links", structured_data: "Structured data" };
  for (const [key, label] of Object.entries(categoryLabels)) {
    ensure(18);
    y -= 16;
    drawText(label, MARGIN, y, 8.5, "0.61 0.64 0.69");
    const score = input.report.categoryScores[key];
    drawText(score === null || score === undefined ? "Not measured" : `${score}/100`, PAGE_WIDTH - MARGIN - 76, y, 8.5, "0.96 0.97 0.98", true);
  }
  y -= 12;
  drawText(`Findings (${input.issues.length}${input.issues.length >= 500 ? "+ shown" : ""})`, MARGIN, y, 12, "0.96 0.97 0.98", true);
  y -= 7;
  drawRule();
  y -= 9;

  if (input.issues.length === 0) drawBlock("No deterministic findings were recorded for this crawl.", MARGIN, PAGE_WIDTH - MARGIN * 2, 9, "0.61 0.64 0.69");
  for (const issue of input.issues) {
    ensure(68);
    y -= 4;
    const severityColor = issue.severity === "critical" || issue.severity === "high" ? "0.94 0.37 0.37" : issue.severity === "medium" ? "0.96 0.72 0.18" : "0.61 0.64 0.69";
    drawText(`${issue.severity.toUpperCase()}  ·  ${issue.category.replaceAll("_", " ")}`, MARGIN, y, 7.5, severityColor, true);
    drawBlock(issue.description, MARGIN, PAGE_WIDTH - MARGIN * 2, 8.5, "0.96 0.97 0.98", true, 11);
    drawBlock(issue.url || input.project.websiteUrl, MARGIN, PAGE_WIDTH - MARGIN * 2, 7.2, "0.22 1 0.08", false, 9.5);
    drawBlock(issue.recommendation, MARGIN, PAGE_WIDTH - MARGIN * 2, 7.5, "0.61 0.64 0.69", false, 10);
    y -= 7;
    if (y > 58) drawRule();
  }
  if (content) pages.push(content);
  for (let index = 0; index < pages.length; index += 1) {
    pages[index] += `0.61 0.64 0.69 rg BT /F1 7 Tf 1 0 0 1 ${MARGIN} 26 Tm (Rule set ${pdfText(input.report.scoreMethodologyVersion)} - pages observed within crawl limit and robots policy.) Tj ET\n`;
  }
  return assemblePdf(pages);
}

function assemblePdf(pages: string[]) {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds: number[] = [];
  pages.forEach((stream) => {
    const contentId = objects.length + 1;
    const streamLength = Buffer.byteLength(stream, "ascii");
    objects.push(`<< /Length ${streamLength} >>\nstream\n${stream}endstream`);
    const pageId = objects.length + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /ProcSet [/PDF /Text] /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let document = "%PDF-1.4\n%SEOFlow\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(document, "ascii"));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) document += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(document, "ascii");
}

function wrapPdfText(value: string, width: number, fontSize: number) {
  const maxChars = Math.max(12, Math.floor(width / (fontSize * 0.52)));
  const words = plainText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const segments = word.length > maxChars ? word.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [word] : [word];
    for (const segment of segments) {
      if (!line) line = segment;
      else if (`${line} ${segment}`.length <= maxChars) line += ` ${segment}`;
      else { lines.push(line); line = segment; }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function pdfText(value: string) {
  return plainText(value).replace(/[\\()]/g, (character) => `\\${character}`);
}

function plainText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "?").replace(/[\r\n]/g, " ");
}
