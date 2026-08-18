"use client";

/** Triggers the browser print dialog. Split out so the roster print page itself can stay a server component. */
export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      Print
    </button>
  );
}
