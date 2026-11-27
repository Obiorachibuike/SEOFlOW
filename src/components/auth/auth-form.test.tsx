// @vitest-environment jsdom
/**
 * Component tests for the AuthForm (sign in / sign up / Google).
 *
 * Better Auth's client is mocked at the module boundary; tests assert the
 * user-facing behaviour: loading states always terminate, duplicate
 * submissions are prevented, unexpected errors surface a reference ID and
 * never raw backend details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { signInEmail, signUpEmail, signInSocial, replace, refresh } = vi.hoisted(() => ({
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  signInSocial: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn()
}));

vi.mock("@/auth/client", () => ({
  authClient: {
    signIn: { email: signInEmail, social: signInSocial },
    signUp: { email: signUpEmail }
  }
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams("")
}));

import { AuthForm } from "./auth-form";

const REFERENCE_ID = "108e9014-5cf3-4202-9b5b-9e31d0a9d620";

function fillSigninForm(overrides: { email?: string; password?: string } = {}) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: overrides.email ?? "ada@example.com" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: overrides.password ?? "correct horse battery" } });
}

function submitForm() {
  fireEvent.submit(screen.getByRole("button", { name: /(sign in|create account|create your account)/i }).closest("form")!);
}

beforeEach(() => {
  vi.clearAllMocks();
  signInEmail.mockResolvedValue({ data: { user: { email: "ada@example.com" } }, error: null });
  signUpEmail.mockResolvedValue({ data: { user: { email: "ada@example.com" } }, error: null });
  signInSocial.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
});

describe("login mode", () => {
  it("signs in and redirects to the dashboard", async () => {
    render(<AuthForm mode="login" />);
    fillSigninForm();
    submitForm();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the server-provided message on invalid credentials", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password", status: 401 }
    });
    render(<AuthForm mode="login" />);
    fillSigninForm({ password: "wrong-password" });
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toMatch("Invalid email or password");
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows the reference ID when the server returns our structured 500 payload", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { code: "DATABASE_CONNECTION_ERROR", message: "The authentication service is unavailable right now. Please try again shortly.", referenceId: REFERENCE_ID, status: 503 }
    });
    render(<AuthForm mode="login" />);
    fillSigninForm();
    submitForm();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(REFERENCE_ID);
  });

  it("never renders raw backend internals from a 5xx failure", async () => {
    signInEmail.mockResolvedValue({
      data: null,
      error: { message: 'relation "user" does not exist (connection string postgres://u:p@db:5432/x)', status: 500 }
    });
    render(<AuthForm mode="login" />);
    fillSigninForm();
    submitForm();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/relation|postgres|does not exist/i);
    expect(alert.textContent).toMatch(/try again/i);
  });

  it("reports a network-level failure with a connection message", async () => {
    signInEmail.mockRejectedValue(new TypeError("fetch failed"));
    render(<AuthForm mode="login" />);
    fillSigninForm();
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toMatch(/check your connection/i);
  });

  it("rejects an invalid email address without calling the server", async () => {
    render(<AuthForm mode="login" />);
    fillSigninForm({ email: "not-an-email" });
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toMatch(/valid email/i);
    expect(signInEmail).not.toHaveBeenCalled();
  });

  it("prevents duplicate submissions while a request is in flight", async () => {
    let resolveRequest: (value: { data: unknown; error: null }) => void = () => undefined;
    signInEmail.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        })
    );
    render(<AuthForm mode="login" />);
    fillSigninForm();
    const form = screen.getByRole("button", { name: /sign in/i }).closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.submit(form);
    resolveRequest({ data: { user: { email: "ada@example.com" } }, error: null });
    await waitFor(() => expect(replace).toHaveBeenCalled());
    expect(signInEmail).toHaveBeenCalledTimes(1);
  });
});

describe("signup mode", () => {
  it("shows the verification notice after a successful signup and does not redirect", async () => {
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Ada Lovelace" } });
    fillSigninForm();
    submitForm();
    expect(await screen.findByText(/check your inbox/i)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("requires a password of at least eight characters", async () => {
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Ada Lovelace" } });
    fillSigninForm({ password: "short" });
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toMatch(/at least 8 characters/i);
    expect(signUpEmail).not.toHaveBeenCalled();
  });

  it("surfaces a referenceId from the structured 500 on signup failure", async () => {
    signUpEmail.mockResolvedValue({
      data: null,
      error: { code: "AUTH_DATABASE_ERROR", message: "The authentication service is unavailable right now. Please try again shortly.", referenceId: REFERENCE_ID, status: 500 }
    });
    render(<AuthForm mode="signup" />);
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Ada Lovelace" } });
    fillSigninForm();
    submitForm();
    expect((await screen.findByRole("alert")).textContent).toMatch(REFERENCE_ID);
  });
});

describe("Google sign-in", () => {
  const ORIGINAL_ENV = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED = "true";
  });

  afterEach(() => {
    process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED = ORIGINAL_ENV;
  });

  it("invokes the social endpoint and reports failures", async () => {
    signInSocial.mockResolvedValue({ data: null, error: { message: "oauth unavailable", status: 503 } });
    render(<AuthForm mode="login" />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/unavailable/i);
    expect(signInSocial).toHaveBeenCalledWith(expect.objectContaining({ provider: "google" }));
  });

  it("handles network failure during Google sign-in", async () => {
    signInSocial.mockRejectedValue(new TypeError("fetch failed"));
    render(<AuthForm mode="login" />);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't reach google/i);
  });
});
