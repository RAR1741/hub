import { cloneElement, isValidElement, useId, type ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  children: ReactNode;
}) {
  const reactId = useId();
  const controlId = htmlFor ?? reactId;
  const errorId = error ? `${controlId}-error` : undefined;

  const control =
    isValidElement<{ id?: string; "aria-describedby"?: string }>(children)
      ? cloneElement(children, {
          id: children.props.id ?? controlId,
          "aria-describedby":
            [children.props["aria-describedby"], errorId]
              .filter(Boolean)
              .join(" ") || undefined,
        })
      : children;

  return (
    <label className="label" htmlFor={controlId}>
      {label}
      {control}
      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </label>
  );
}
