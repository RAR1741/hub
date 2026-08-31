import type { ReactNode } from "react";

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
  const errorId = htmlFor && error ? `${htmlFor}-error` : undefined;
  return (
    <label className="label" htmlFor={htmlFor}>
      {label}
      {children}
      {error ? (
        <span id={errorId} role="alert" className="field-error">
          {error}
        </span>
      ) : null}
    </label>
  );
}
