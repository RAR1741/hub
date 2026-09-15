import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SiteNav } from "@/components/SiteNav";
import { SiteTopbar } from "@/components/SiteTopbar";
import { SidebarKeyShortcut } from "@/components/SidebarToggle";
import { MasqueradeBanner } from "@/components/MasqueradeBanner";
import { AppShell } from "@/components/AppChrome";
import { fontVariables, noFlashThemeScript } from "./root-document";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "1741 Hub",
    template: "%s - 1741 Hub",
  },
  description: "Attendance and roster for FRC Team 1741.",
  appleWebApp: {
    capable: true,
    title: "1741 Hub",
    statusBarStyle: "default",
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Apply a persisted cookie choice server-side so the theme survives even when
  // the browser blocks localStorage (guest/kiosk modes) — no JS or inline script
  // needed. The inline script below still covers legacy localStorage-only choices.
  const jar = await cookies();
  const cookieTheme = jar.get("hub-theme")?.value;
  const theme = cookieTheme === "light" || cookieTheme === "dark" ? cookieTheme : undefined;
  // Collapsed icon-rail choice, applied server-side (same no-flash pattern as
  // the theme). Absent → expanded, since the CSS only keys on "collapsed".
  const nav = jar.get("hub-nav")?.value === "collapsed" ? "collapsed" : undefined;
  return (
    <html
      lang="en"
      data-theme={theme}
      data-nav={nav}
      className={fontVariables}
      // The no-flash script below sets data-theme on <html> before hydration
      // from localStorage, which the server can't know — suppress the expected
      // one-level attribute diff (does not affect children).
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashThemeScript }} />
      </head>
      <body className="antialiased">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <SidebarKeyShortcut />
        <AppShell
          sidebar={<SiteNav />}
          topbar={<SiteTopbar />}
          banner={<MasqueradeBanner />}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
