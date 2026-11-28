/**
 * Account email delivery for SEOFlow.
 *
 * Providers (selected by `EMAIL_PROVIDER`):
 * - unset / "smtp" — nodemailer over SMTP_* (default; unchanged behavior).
 * - "ses"          — Amazon SES using the shared AWS credential resolution
 *   (Vercel OIDC role preferred; static keys as fallback). Requires a
 *   verified sender (`SES_FROM_EMAIL`, falling back to `SMTP_FROM`) and a
 *   configured AWS region.
 *
 * There is deliberately no silent cross-provider fallback: if SES is
 * requested and misconfigured or failing, the error is classified
 * (SES_DELIVERY_ERROR / AWS_*) and thrown for the auth layer to surface
 * with a reference ID. In production without any provider configured,
 * sending fails closed; in development, links are printed to the server log.
 */

import nodemailer, { type Transporter } from "nodemailer";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { AppError, ERROR_CODES, PUBLIC_MESSAGES } from "@/lib/errors";
import { getAwsCredentials, resolveAwsRegion } from "@/lib/aws/config";
import { classifyAwsError } from "@/lib/aws/errors";
import { logger, errorDiagnostics } from "@/lib/logger";
import { publishOperationalMetric } from "@/lib/monitoring/cloudwatch";

export type AccountEmailInput = { to: string; subject: string; url: string; action: "verify" | "reset" | "invite" };

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

function actionTextFor(action: AccountEmailInput["action"]): string {
  return action === "verify" ? "Verify your email" : action === "reset" ? "Reset your password" : "Accept your SEOFlow workspace invitation";
}

function buildMessage(input: AccountEmailInput) {
  const actionText = actionTextFor(input.action);
  const html = `<p>${actionText}.</p><p><a href="${escapeHtml(input.url)}">${actionText}</a></p><p>If you did not request this, you can safely ignore this email.</p>`;
  const text = `${actionText}: ${input.url}`;
  return { actionText, html, text };
}

async function sendViaSes(input: AccountEmailInput): Promise<void> {
  const operation = "email.ses-send";
  const from = process.env.SES_FROM_EMAIL?.trim() || process.env.SMTP_FROM?.trim();
  if (!from) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation,
      category: "configuration",
      retryable: false,
      details: { reason: "EMAIL_PROVIDER=ses requires SES_FROM_EMAIL (or SMTP_FROM) with a verified SES sender identity" }
    });
  }
  const region = resolveAwsRegion();
  if (!region) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation,
      category: "configuration",
      retryable: false,
      details: { reason: "EMAIL_PROVIDER=ses requires AWS_REGION (or S3_REGION)" }
    });
  }
  const credentials = await getAwsCredentials(operation);
  if (!credentials) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation,
      category: "configuration",
      retryable: false,
      details: { reason: "EMAIL_PROVIDER=ses requires the Vercel AWS integration (AWS_ROLE_ARN + VERCEL_OIDC_TOKEN) or static AWS credentials" }
    });
  }

  const { html, text } = buildMessage(input);
  const client = new SESClient({ region, credentials });
  try {
    await client.send(new SendEmailCommand({
      Source: from,
      Destination: { ToAddresses: [input.to] },
      Message: {
        Subject: { Data: input.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: text, Charset: "UTF-8" },
          Html: { Data: html, Charset: "UTF-8" }
        }
      }
    }));
  } catch (error) {
    const awsError = classifyAwsError(error, operation);
    const appError = new AppError(ERROR_CODES.SES_DELIVERY_ERROR, PUBLIC_MESSAGES.SES_DELIVERY_ERROR, {
      operation,
      cause: awsError,
      referenceId: awsError.referenceId,
      retryable: awsError.retryable,
      details: { providerCode: awsError.code, action: input.action }
    });
    logger.error("SES_DELIVERY_FAILED", {
      operation,
      code: appError.code,
      referenceId: appError.referenceId,
      action: input.action,
      providerCode: awsError.code,
      ...errorDiagnostics(awsError.cause ?? awsError)
    });
    void publishOperationalMetric({ name: "EmailDeliveryFailure", dimensions: { provider: "ses", action: input.action } });
    throw appError;
  } finally {
    client.destroy();
  }
}

async function sendViaSmtp(input: AccountEmailInput): Promise<void> {
  const client = getTransporter();
  const { html, text } = buildMessage(input);

  if (!client) {
    if (process.env.NODE_ENV === "production") {
      throw new AppError(ERROR_CODES.EMAIL_DELIVERY_ERROR, PUBLIC_MESSAGES.EMAIL_DELIVERY_ERROR, {
        operation: "email.smtp-send",
        category: "configuration",
        retryable: false,
        details: { reason: "SMTP_HOST, SMTP_USER and SMTP_PASSWORD are required when EMAIL_PROVIDER is not set to an alternative" }
      });
    }
    console.info(`[SEOFlow development email] ${input.action} link for ${input.to}: ${input.url}`);
    return;
  }

  await client.sendMail({
    from: process.env.SMTP_FROM ?? "SEOFlow <no-reply@example.com>",
    to: input.to,
    subject: input.subject,
    text,
    html
  });
}

export async function sendAccountEmail(input: AccountEmailInput) {
  const provider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase() || "smtp";
  if (provider === "ses") return sendViaSes(input);
  if (provider === "smtp") return sendViaSmtp(input);
  throw new AppError(ERROR_CODES.EMAIL_DELIVERY_ERROR, PUBLIC_MESSAGES.EMAIL_DELIVERY_ERROR, {
    operation: "email.provider-select",
    category: "configuration",
    retryable: false,
    details: { reason: "unsupported EMAIL_PROVIDER value" }
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
