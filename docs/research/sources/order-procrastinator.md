# order-procrastinator — Source Survey

**Repo:** plusparth/order-procrastinator — https://github.com/plusparth/order-procrastinator
**Surveyed-at:** 8ac504165723aeaa0c6559fc01010ee5329b10ac
**Permalink form:** https://github.com/plusparth/order-procrastinator/blob/8ac504165723aeaa0c6559fc01010ee5329b10ac/<path>
**Stack:** Browser extension (WebExtensions API, Manifest V2), vanilla JS + jQuery 3.4.1, no build system, no backend/DB
**License:** MIT (LICENSE file present, Copyright 2019 Parth Oza) — free to reuse/adapt with attribution
**Last activity:** 2019-09-27 (single-shot project, no subsequent commits)
**FRC team:** unknown (author "Parth Oza" / GitHub handle plusparth; no team number in repo)
**Areas:** (5) parts ordering/POs

## Purpose
A browser-extension popup that scrapes the current shopping cart off a handful of FRC vendor storefronts (VEX Robotics, AndyMark, West Coast Products, The Robot Space) and dumps the line items into a textarea as tab-separated text, so a team member can copy that list somewhere durable and later re-populate/recall a cart instead of re-searching every part. Despite the repo description ("saves ... to Google Sheets and recalls them to carts"), **no Google Sheets integration or cart-recall/re-add-to-cart code exists in this commit** — only the scrape-to-textarea half is implemented.

## Auth & Roles
None. It's a local, single-user browser extension; it never touches vendor accounts beyond whatever cart state is already loaded in the active tab (`activeTab` permission only).

## Data Model
No persistent storage at all — no DB, no `chrome.storage`, no file writes. The only "model" is an in-memory `Product` class per scrape:
- `Product { name, number, url, vendor, price, quantity }` — defined in `assets/js/read-carts.js`.
Output is ephemeral: rendered into a `<textarea>` in the popup and lost when the popup closes (nothing persists it).

## Features
**Parts ordering / POs**
- Manifest-declared content-script injection scoped to four vendor domains (`vexrobotics.com`, `andymark.com`, `wcproducts.net`, `therobotspace.com`) — `manifest.json`
- Popup UI: single "Get cart" button + read-only output textarea — `popup/procrastinator_ui.html`
- Popup-side orchestration (`popup/ui.js`): on click, finds the active tab, detects which vendor site it's on by URL substring match, and if the tab isn't already on that vendor's cart page, navigates it there first (`browser.tabs.update`) before requesting the scrape — handles VEX (`/checkout/cart/`), WCP (`/checkout/cart/`), AndyMark (`/cart`), and The Robot Space (`/AjaxCart.asp`) cart URLs per-vendor
- Content-script cart scraping (`assets/js/read-carts.js`, `grabCart()`), one branch per vendor, each with a bespoke DOM/JSON scraping strategy:
  - VEX Robotics: jQuery table-row scraping of `#shopping-cart-table`, pulling name/URL from `h2.product-name`, SKU from `div.product-cart-sku` (stripped of a fixed-length prefix), price from `span.cart-price`, quantity from the row's quantity `<input>`
  - AndyMark: reads a JSON blob out of a `data-analytics` DOM attribute on `div.cart` (site embeds its own analytics payload with cart contents) rather than scraping visible markup — builds product URLs as `andymark.com/<sku>`
  - West Coast Products (wcproducts.net): near-identical table scrape to VEX but with different CSS selectors (`col-unit-price`, `a-center` quantity cell), reflecting the two sites likely sharing a cart template
  - The Robot Space: parses the entire page body as JSON (`AjaxCart.asp` returns a JSON cart API, not HTML), extracts `Products[]` array with `ProductName`/`ProductCode`/`ProductPrice`/`Quantity`
  - Results returned to the popup as a message (`browser.runtime.onMessage` / `sendMessage`) and rendered as tab-separated rows (name, number, url, vendor, price, quantity) in the textarea

## Integrations
None beyond the vendor storefronts themselves (read-only DOM/JSON scraping via content scripts). No Google Sheets, no Slack/Discord, no email, no OAuth — despite what the repo description implies, none of that is present in the code.

## Notable Implementation Details
- Uses the standard `browser.*` WebExtensions promise API (Firefox-style) rather than callback-based `chrome.*`, so as-is it likely needs a polyfill or Manifest V3 port to run reliably in Chrome.
- Manifest V2 and jQuery 3.4.1 vendored directly into the repo (`lib/jquery-3.4.1.min.js`) — both are dated; a re-implementation should use MV3 (`manifest_version: 3`, service-worker background, `scripting.executeScript`) and skip jQuery entirely (`querySelectorAll` covers everything used here).
- Per-vendor scraping is inherently brittle: it hardcodes each site's DOM class names / JSON shape as of 2019, so any vendor storefront redesign silently breaks that branch with no error surfacing (`handleError()` in `read-carts.js` is an empty stub — failures are swallowed, not reported to the user).
- The auto-navigate-to-cart-page-then-scrape pattern (checking `tabInfo.url`, redirecting via `tabs.update`, then re-invoking `messageForCart`) is a reasonable, reusable idea for a "one-click cart export" tool regardless of vendor.
- The core reusable idea — a normalized `{name, number, url, vendor, price, quantity}` line-item shape scraped from heterogeneous vendor cart pages — is the main thing worth carrying forward; the actual "save to Sheets" / "recall to cart" half implied by the project name/description was never built in this commit.

## Verdict
Thin but relevant: a real, working (circa-2019) one-way cart scraper for 4 FRC vendor sites, MIT-licensed, but it's essentially a proof-of-concept for the *scrape* step only — no persistence, no recall/re-cart, no Sheets sync despite the name. Worth stealing: the normalized per-vendor cart-item schema and the per-vendor DOM-scraping selectors as a starting point/reference for a real "export cart across vendors" feature; the "save & recall" half described in the README would need to be built from scratch.
