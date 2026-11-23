import { expect, test } from "@playwright/test";

test("public homepage explains the evidence-first SEO workflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: /Make every SEO move count/i })).toBeVisible();
  await expect(page.getByText("Discover. Optimize. Rank.")).toBeVisible();
  await expect(page.getByRole("link", { name: /Start free/i })).toHaveAttribute("href", "/signup");
  await expect(page.getByText(/not a Google ranking score/i).last()).toBeVisible();
});

test("sign-up page requires a name, email and strong-enough password", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your workspace" })).toBeVisible();
  await expect(page.getByLabel("Your name")).toBeVisible();
  await expect(page.getByLabel("Email address")).toHaveAttribute("type", "email");
  await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "8");
});
