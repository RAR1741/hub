import type { Metadata } from "next";
import { Archivo, Inter, JetBrains_Mono } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-display",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-body",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Team Hub",
  description: "Attendance and roster for FRC Team 1741.",
};

// Applies a persisted theme choice (light/dark) before first paint so there's
// no flash of the wrong theme. With no stored choice we leave the attribute
// off and let the prefers-color-scheme media query in globals.css follow the OS.
const noFlashThemeScript = `
(function () {
  try {
    var theme = localStorage.getItem("hub-theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${archivo.variable} ${inter.variable} ${jetbrainsMono.variable}`}
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
        <SiteNav />
        <div id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 flex flex-col">
          {children}
        </div>
      </body>
    </html>
  );
}
