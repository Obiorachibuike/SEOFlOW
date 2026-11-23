import nodemailer, { type Transporter } from "nodemailer";

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: Number(process.env.SMTP_PORT ?? 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    });
  }
  return transporter;
}

export async function sendAccountEmail(input: { to: string; subject: string; url: string; action: "verify" | "reset" | "invite" }) {
  const client = getTransporter();
  const actionText = input.action === "verify" ? "Verify your email" : input.action === "reset" ? "Reset your password" : "Accept your SEOFlow workspace invitation";
  const html = `<p>${actionText}.</p><p><a href="${escapeHtml(input.url)}">${actionText}</a></p><p>If you did not request this, you can safely ignore this email.</p>`;

  if (!client) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required for account email delivery.");
    console.info(`[SEOFlow development email] ${input.action} link for ${input.to}: ${input.url}`);
    return;
  }

  await client.sendMail({
    from: process.env.SMTP_FROM ?? "SEOFlow <no-reply@example.com>",
    to: input.to,
    subject: input.subject,
    text: `${actionText}: ${input.url}`,
    html
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
