import type { HTMLAttributes } from "react";

export function Avatar({
  initials,
  role,
  className = "",
  ...rest
}: { initials: string; role?: "student" | "mentor" | "admin" } & HTMLAttributes<HTMLSpanElement>) {
  const cls = ["avatar", role ? `role-${role}` : "", className].filter(Boolean).join(" ");
  return (
    <span className={cls} aria-hidden="true" {...rest}>
      {initials}
    </span>
  );
}
