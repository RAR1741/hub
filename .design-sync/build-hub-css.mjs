// Generates .design-sync/hub.css from src/app/globals.css — the self-contained
// stylesheet Claude Design consumes as styles.css (via cfg.cssEntry).
//
// globals.css can't be shipped as-is: it starts with `@import "tailwindcss"`,
// which won't resolve in the design sandbox, and wraps the component vocabulary
// in `@layer` (layered rules lose to any unlayered rule in the sandbox's own
// Tailwind). This transform:
//   1. drops the tailwindcss import (the sandbox already has Tailwind for glue),
//   2. unwraps `@layer base/components { … }` so the tokens + classes are
//      unlayered and authoritative,
//   3. prepends a Google Fonts @import + the --font-* vars that next/font injects
//      at runtime in the real app (so `var(--font-display)` etc. resolve here).
// Re-run on any globals.css change: `./dev node .design-sync/build-hub-css.mjs`.
import fs from "node:fs";

const src = fs.readFileSync("src/app/globals.css", "utf8");

// 1. drop the Tailwind import
let css = src.replace(/@import\s+["']tailwindcss["'];\s*\n?/, "");

// 2. unwrap every `@layer <names> { … }` block by brace-matching
function unwrapLayers(input) {
  const re = /@layer\s+[\w,\s]+\{/;
  let m;
  while ((m = re.exec(input))) {
    const open = m.index;
    const contentStart = open + m[0].length;
    let depth = 1;
    let j = contentStart;
    for (; j < input.length; j++) {
      if (input[j] === "{") depth++;
      else if (input[j] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    input = input.slice(0, open) + input.slice(contentStart, j) + input.slice(j + 1);
  }
  return input;
}
css = unwrapLayers(css);

// 3. fonts: Archivo (display), Inter (body), JetBrains Mono (mono) — variable
// weight ranges because the component CSS uses 650/750/800/850.
const header = `@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@100..900&family=Inter:wght@100..900&family=JetBrains+Mono:wght@100..800&display=swap');

/* --font-* are injected by next/font/google in the real app (layout.tsx); here
   they're defined statically so the shipped classes resolve their families. */
:root {
  --font-display: "Archivo";
  --font-body: "Inter";
  --font-mono: "JetBrains Mono";
}

`;

fs.writeFileSync(".design-sync/hub.css", header + css);
console.log("wrote .design-sync/hub.css (" + (header.length + css.length) + " bytes)");
