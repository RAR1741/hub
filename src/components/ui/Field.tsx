import { Fragment, cloneElement, isValidElement, useId, type ReactNode } from "react";

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
  const isElement = isValidElement<{ id?: string; "aria-describedby"?: string }>(children);
  const childId = isElement ? (children.props.id ?? controlId) : controlId;

  const control = isElement
    ? cloneElement(children, {
        id: childId,
        "aria-describedby":
          [children.props["aria-describedby"], errorId]
            .filter(Boolean)
            .join(" ") || undefined,
      })
    : children;

  return (
    <Fragment>
      <label className="label" htmlFor={childId}>
        {label}
        {control}
      </label>
      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </Fragment>
  );
}
