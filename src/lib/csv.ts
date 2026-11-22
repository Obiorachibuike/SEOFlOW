export function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safeText = typeof value === "string" && /^[\s]*[=+@\-]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}
