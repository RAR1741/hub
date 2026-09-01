import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn btn-primary",
  secondary: "btn btn-secondary",
  danger: "btn btn-danger",
};

export function Button({
  variant = "primary",
  icon = false,
  pending = false,
  pendingLabel,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: {
  variant?: Variant;
  icon?: boolean;
  pending?: boolean;
  pendingLabel?: string;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = [VARIANT_CLASS[variant], icon ? "icon" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button className={cls} type={type} disabled={disabled || pending} {...rest}>
      {pending ? pendingLabel ?? children : children}
    </button>
  );
}
