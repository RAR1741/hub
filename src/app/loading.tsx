// Route-level streaming fallback (#300). Placed at the app root, so it is the
// Suspense fallback for every segment that doesn't define its own — only
// /onshape does, and its panel-shaped skeleton keeps winning for that subtree.
//
// Deliberately generic: every page renders the same
// `<main className="flex flex-col gap-6">` + `.page-head` + cards shell, so one
// skeleton matches the layout of all of them without shifting content when the
// real page swaps in. Add a segment-local loading.tsx only where a page's shape
// makes this read wrong.
export default function Loading() {
  return (
    <main className="flex flex-col gap-6" aria-busy="true" aria-label="Loading">
      <div className="page-head" aria-hidden>
        <div className="flex flex-col gap-2">
          <div className="skeleton-line" style={{ width: "12rem", height: "22px" }} />
          <div className="skeleton-line" style={{ width: "18rem", height: "13px" }} />
        </div>
        <div className="skeleton-line" style={{ width: "6rem", height: "2rem" }} />
      </div>

      <div className="flex flex-col gap-3" aria-hidden>
        {[0, 1, 2].map((i) => (
          <div key={i} className="card flex flex-col gap-3">
            <div className="skeleton-line" style={{ width: "40%", height: "1rem" }} />
            <div className="skeleton-line" style={{ width: "100%", height: "1rem" }} />
            <div className="skeleton-line" style={{ width: "70%", height: "1rem" }} />
          </div>
        ))}
      </div>
    </main>
  );
}
