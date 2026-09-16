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

// Regression guard for #296: on a viewport shorter than the nav (a landscape
// phone, or a 768px laptop at 150% zoom), the sidebar/rail footer — which holds
// the only collapse/expand control — fell off the bottom of a `height: 100dvh`
// box that nothing could scroll. `min-height` plus `position: sticky; bottom: 0`
// on .sb-foot / .rail-foot pins it to the viewport bottom instead.
test("sidebar and rail footers stay reachable on a viewport shorter than the nav", async ({
  page,
}) => {
  // Mentor nav (4 groups, 10 inline links) is ~505px tall; 300px is well under.
  await page.goto("/people");
  await page.setViewportSize({ width: 1280, height: 300 });

  // Each click asserts more than visibility: Playwright fails it if the control
  // is off-screen or covered, which is exactly the broken state.
  const collapse = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(collapse).toBeInViewport();
  await collapse.click();

  const expand = page.getByRole("button", { name: "Expand sidebar" });
  await expect(page.locator(".rail")).toBeVisible();
  await expect(expand).toBeInViewport();
  await expand.click();

  await expect(page.locator(".sb")).toBeVisible();
});
