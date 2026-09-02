import { expect, test } from "@playwright/test";
import { mentorSessionCookie } from "./helpers/session";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";

test.beforeEach(async ({ context }) => {
  await context.addCookies([await mentorSessionCookie(BASE)]);
});

// Regression guard for a CSS bug where the top bar (`.topbar`) and sidebar
// (`.sb` expanded / `.rail` collapsed) scrolled away with the page instead of
// staying pinned. Both are `position: sticky; top: 0` in src/app/globals.css,
// but `overflow-x: hidden` on html/body forces overflow-y to compute to
// `auto`, turning <body> into a scroll container — which breaks `sticky`
// (it needs the *viewport*, not an ancestor scroll container, to stick to).
// The fix uses `overflow-x: clip` instead, which suppresses the same
// horizontal overflow without creating a scroll container.
test("topbar and sidebar stay pinned to the top when the page scrolls", async ({
  page,
}) => {
  // Mentor sees all nav groups (Overview / Shop floor / Team / Admin), and
  // /people has a long roster — both make the page reliably taller than a
  // short viewport so it can actually scroll.
  await page.goto("/people");

  // Short viewport so the page overflows. Desktop width is required — chrome
  // is `display:none` below 768px (mobile tab bar takes over instead). Set
  // after goto so the initial layout/dvh units resolve against it cleanly.
  await page.setViewportSize({ width: 1280, height: 300 });

  // A modest scroll, not the document's max: `overflow-x: clip` still lets
  // hidden hover-flyout menus (positioned off-screen) contribute to
  // `document.scrollHeight`, so scrolling to the true max would scroll past
  // the sidebar's own (100dvh-tall) box and legitimately detach it per spec
  // — a false failure unrelated to the sticky-chrome bug this test guards.
  await page.evaluate(() => window.scrollTo(0, 150));

  // Guard against a false pass: if the page didn't actually scroll, scrollY
  // stays 0 and a broken (non-sticky) topbar/sidebar would still measure at
  // y=0, making the assertions below pass for the wrong reason.
  const scrollY = await page.evaluate(() => window.scrollY);
  expect(scrollY).toBeGreaterThan(0);

  const topbar = page.locator(".topbar");
  await expect(topbar).toBeVisible();
  const topbarBox = await topbar.boundingBox();
  expect(topbarBox).not.toBeNull();
  expect(Math.abs(topbarBox!.y)).toBeLessThanOrEqual(1);

  // Only one of .sb (expanded, default) / .rail (collapsed) is visible.
  const sidebar = page.locator(".sb, .rail").locator("visible=true");
  await expect(sidebar).toBeVisible();
  const sidebarBox = await sidebar.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(Math.abs(sidebarBox!.y)).toBeLessThanOrEqual(1);
});
