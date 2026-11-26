export type AuthErrorDetails = {
  message: string;
  code: string;
  requestId?: string;
};

export type AuthErrorOptions = {
  fallbackMessage?: string;
  requestId?: string;
};

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  AUTH_INVALID_EMAIL_OR_PASSWORD: "That email and password combination did not match. Check your details and try again.",
  AUTH_INVALID_EMAIL: "Enter a valid email address and try again.",
  AUTH_INVALID_PASSWORD: "The password is invalid. Check it and try again.",
  AUTH_PASSWORD_TOO_SHORT: "Choose a longer password. It must be at least eight characters.",
  AUTH_PASSWORD_TOO_LONG: "Choose a shorter password and try again.",
  AUTH_EMAIL_NOT_VERIFIED: "Your email address is not verified yet. Check your inbox and spam folder, or resend the verification email.",
  AUTH_EMAIL_DELIVERY_NOT_CONFIGURED: "SEOFlow cannot send verification emails right now, so email registration is temporarily unavailable. Contact the site administrator and share this error code.",
  AUTH_EMAIL_DELIVERY_FAILED: "SEOFlow could not deliver the verification email. Please try again later or contact the site administrator with this error code.",
  AUTH_DATABASE_ERROR: "SEOFlow could not reach or query its account database. Please try again later and share this error code with the site administrator.",
  AUTH_SERVER_ERROR: "SEOFlow's authentication service encountered a server error. Please try again shortly and share this error code with the site administrator.",
  AUTH_INTERNAL_SERVER_ERROR: "SEOFlow's authentication service encountered a server error. Please try again shortly and share this error code with the site administrator.",
  AUTH_NETWORK_ERROR: "Could not reach SEOFlow's authentication service. Check your connection and try again.",
  AUTH_RATE_LIMITED: "Too many attempts were made. Wait a moment before trying again.",
  AUTH_USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "This email may already be linked to an account. Try signing in or resetting your password.",
  AUTH_USER_ALREADY_EXISTS: "This email may already be linked to an account. Try signing in or resetting your password.",
  AUTH_FAILED_TO_CREATE_USER: "SEOFlow could not create your account. Please try again later and share this error code with the site administrator.",
  AUTH_FAILED_TO_CREATE_SESSION: "Your credentials were accepted, but SEOFlow could not start a session. Please try again and share this error code with the site administrator.",
  AUTH_INVALID_ORIGIN: "The authentication request came from an unrecognized site address. Contact the site administrator and share this error code.",
  AUTH_MISSING_OR_NULL_ORIGIN: "The authentication request was missing its site address. Refresh the page and try again; if it persists, share this error code with the site administrator.",
  AUTH_INVALID_CALLBACK_URL: "The sign-in return address is not valid. Contact the site administrator and share this error code.",
  AUTH_INVALID_REDIRECT_URL: "The sign-in redirect address is not valid. Contact the site administrator and share this error code.",
  AUTH_PROVIDER_NOT_FOUND: "Google sign-in is not configured for this deployment. Use email sign-in or contact the site administrator.",
  AUTH_ID_TOKEN_NOT_SUPPORTED: "This sign-in method is not supported. Use another sign-in option or contact the site administrator.",
  AUTH_INVALID_TOKEN: "This sign-in link or token is invalid or expired. Request a new one and try again.",
  AUTH_TOKEN_EXPIRED: "This sign-in link has expired. Request a new one and try again.",
  AUTH_VALIDATION_ERROR: "Some of the information is invalid. Check the form and try again.",
  AUTH_MISSING_FIELD: "Complete all required fields and try again.",
  AUTH_OAUTH_CANCELLED: "Google sign-in was cancelled. Try again or use email and password.",
  AUTH_OAUTH_STATE_MISMATCH: "The Google sign-in request expired or could not be verified. Start sign-in again.",
  AUTH_OAUTH_CALLBACK_ERROR: "Google sign-in could not be completed. Try again or use email and password.",
  AUTH_OAUTH_EMAIL_NOT_VERIFIED: "Google did not return a verified email address. Use a verified Google account or sign in with email and password."
};

const SERVER_SIDE_CODES = new Set([
  "AUTH_EMAIL_DELIVERY_NOT_CONFIGURED",
  "AUTH_EMAIL_DELIVERY_FAILED",
  "AUTH_DATABASE_ERROR",
  "AUTH_SERVER_ERROR",
  "AUTH_INTERNAL_SERVER_ERROR",
  "AUTH_FAILED_TO_CREATE_USER",
  "AUTH_FAILED_TO_CREATE_SESSION"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!normalized || normalized.length > 80) return undefined;
  return normalized.startsWith("AUTH_") ? normalized : `AUTH_${normalized}`;
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const id = value.trim();
  return /^[A-Za-z0-9-]{8,80}$/.test(id) ? id : undefined;
}

function isNetworkFailure(error: unknown, status: number | undefined): boolean {
  if (status === 0) return true;
  if (!isRecord(error)) return false;
  const name = typeof error.name === "string" ? error.name : "";
  const message = typeof error.message === "string" ? error.message : "";
  return name === "AbortError" || /failed to fetch|network ?error|load failed/i.test(message);
}

export function getAuthErrorMessage(code: string): string {
  return AUTH_ERROR_MESSAGES[safeCode(code) ?? code] ?? AUTH_ERROR_MESSAGES.AUTH_SERVER_ERROR;
}

export function getAuthErrorDetails(error: unknown, options: AuthErrorOptions = {}): AuthErrorDetails {
  const root = isRecord(error) ? error : {};
  const nested = isRecord(root.error) ? root.error : root;
  const statusValue = typeof nested.status === "number" ? nested.status : typeof root.status === "number" ? root.status : undefined;
  const statusCodeValue = typeof nested.statusCode === "number" ? nested.statusCode : typeof root.statusCode === "number" ? root.statusCode : undefined;
  const status = statusValue ?? statusCodeValue;
  const rawCode = nested.code ?? root.code;
  const suppliedCode = safeCode(rawCode);
  const requestId = safeRequestId(nested.requestId) ?? safeRequestId(root.requestId) ?? safeRequestId(options.requestId);

  let code = suppliedCode;
  if (isNetworkFailure(error, status)) code = "AUTH_NETWORK_ERROR";
  else if (status === 429) code = "AUTH_RATE_LIMITED";
  else if (status !== undefined && status >= 500 && (!suppliedCode || !SERVER_SIDE_CODES.has(suppliedCode))) code = "AUTH_SERVER_ERROR";
  else if (!code) code = "AUTH_REQUEST_FAILED";

  const rawMessage = typeof nested.message === "string" ? nested.message.trim() : typeof root.message === "string" ? root.message.trim() : "";
  const isSafeClientMessage = status !== undefined && status < 500 && rawMessage.length > 0 && rawMessage.length <= 240 && !/[\r\n]/.test(rawMessage);
  const message = AUTH_ERROR_MESSAGES[code]
    ?? (isSafeClientMessage ? rawMessage : options.fallbackMessage ?? "We could not complete the authentication request. Please try again.");

  return { message, code, ...(requestId ? { requestId } : {}) };
}

export function getOAuthErrorDetails(rawCode: string, requestId?: string): AuthErrorDetails {
  const normalized = rawCode.trim().toLowerCase();
  if (normalized === "access_denied") return { message: AUTH_ERROR_MESSAGES.AUTH_OAUTH_CANCELLED, code: "AUTH_OAUTH_CANCELLED", ...(requestId ? { requestId } : {}) };
  if (normalized === "state_mismatch" || normalized === "state_security_mismatch") return { message: AUTH_ERROR_MESSAGES.AUTH_OAUTH_STATE_MISMATCH, code: "AUTH_OAUTH_STATE_MISMATCH", ...(requestId ? { requestId } : {}) };
  if (normalized === "email_not_verified") return { message: AUTH_ERROR_MESSAGES.AUTH_OAUTH_EMAIL_NOT_VERIFIED, code: "AUTH_OAUTH_EMAIL_NOT_VERIFIED", ...(requestId ? { requestId } : {}) };
  return { message: AUTH_ERROR_MESSAGES.AUTH_OAUTH_CALLBACK_ERROR, code: "AUTH_OAUTH_CALLBACK_ERROR", ...(requestId ? { requestId } : {}) };
}
