import nodemailer, { type Transporter } from "nodemailer";
import { recordAuthServerFailure } from "@/auth/diagnostics";

let transporter: Transporter | null = null;

export class AccountEmailDeliveryError extends Error {
  constructor(public readonly code: "AUTH_EMAIL_DELIVERY_NOT_CONFIGURED" | "AUTH_EMAIL_DELIVERY_FAILED", cause?: unknown) {
    super(code === "AUTH_EMAIL_DELIVERY_NOT_CONFIGURED" ? "Account email delivery is not configured." : "Account email delivery failed.", { cause });
    this.name = "AccountEmailDeliveryError";
  }
}

export function isAccountEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASSWORD);
}

function getTransporter(): Transporter | null {
  if (!isAccountEmailConfigured()) return null;
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
    if (process.env.NODE_ENV === "production") {
      const error = new AccountEmailDeliveryError("AUTH_EMAIL_DELIVERY_NOT_CONFIGURED");
      recordAuthServerFailure(error);
      throw error;
    }
    console.info(`[SEOFlow development email] ${input.action} link for ${input.to}: ${input.url}`);
    return;
  }

  try {
    await client.sendMail({
      from: process.env.SMTP_FROM ?? "SEOFlow <no-reply@example.com>",
      to: input.to,
      subject: input.subject,
      text: `${actionText}: ${input.url}`,
      html
    });
  } catch (cause) {
    const error = new AccountEmailDeliveryError("AUTH_EMAIL_DELIVERY_FAILED", cause);
    recordAuthServerFailure(error);
    throw error;
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
