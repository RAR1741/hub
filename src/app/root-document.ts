import { Archivo, Inter, JetBrains_Mono } from "next/font/google";

// Shared by the root layout and global-error.tsx. global-error replaces the
// layout entirely, so it has to ship its own <html>/<body>, fonts and theme —
// it can't import layout.tsx (a client component can't pull in next/headers).

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

export const fontVariables = `${archivo.variable} ${inter.variable} ${jetbrainsMono.variable}`;

// Applies a persisted theme choice (light/dark) before first paint so there's
// no flash of the wrong theme. With no stored choice we leave the attribute
// off and let the prefers-color-scheme media query in globals.css follow the OS.
export const noFlashThemeScript = `
(function () {
  try {
    var theme = localStorage.getItem("hub-theme");
    if (theme === "light" || theme === "dark") {
      document.documentElement.setAttribute("data-theme", theme);
    }
    var nav = localStorage.getItem("hub-nav");
    if (nav === "collapsed" || nav === "expanded") {
      document.documentElement.setAttribute("data-nav", nav);
    }
  } catch (e) {}
})();
`;
