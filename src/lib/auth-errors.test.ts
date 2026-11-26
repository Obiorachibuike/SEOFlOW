import { describe, expect, it } from "vitest";
import { getAuthErrorDetails, getOAuthErrorDetails } from "@/lib/auth-errors";

describe("authentication error details", () => {
  it("turns Better Auth codes into clear, stable diagnostic messages", () => {
    expect(getAuthErrorDetails({
      code: "INVALID_EMAIL_OR_PASSWORD",
      status: 401,
      message: "Invalid email or password"
    })).toEqual({
      code: "AUTH_INVALID_EMAIL_OR_PASSWORD",
      message: "That email and password combination did not match. Check your details and try again."
    });
  });

  it("keeps server diagnostic codes and includes their reference ID", () => {
    expect(getAuthErrorDetails({
      code: "AUTH_DATABASE_ERROR",
      status: 500,
      message: "database password details must not be shown",
      requestId: "a0b1c2d3-e4f5-6789-abcd-0123456789ab"
    })).toEqual({
      code: "AUTH_DATABASE_ERROR",
      message: "SEOFlow could not reach or query its account database. Please try again later and share this error code with the site administrator.",
      requestId: "a0b1c2d3-e4f5-6789-abcd-0123456789ab"
    });
  });

  it("does not expose unknown server error messages or codes", () => {
    const details = getAuthErrorDetails({
      code: "SECRET_DB_FAILURE",
      status: 500,
      message: "postgres://user:password@host/private"
    });
    expect(details.code).toBe("AUTH_SERVER_ERROR");
    expect(details.message).not.toContain("password");
    expect(details.message).not.toContain("postgres://");
  });

  it("identifies network failures that occur before an API error response", () => {
    const details = getAuthErrorDetails(new TypeError("Failed to fetch"));
    expect(details.code).toBe("AUTH_NETWORK_ERROR");
    expect(details.message).toContain("Check your connection");
  });

  it("maps provider callback errors without displaying provider-supplied descriptions", () => {
    expect(getOAuthErrorDetails("access_denied")).toEqual({
      code: "AUTH_OAUTH_CANCELLED",
      message: "Google sign-in was cancelled. Try again or use email and password."
    });
  });
});
