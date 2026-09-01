import type { HTMLAttributes } from "react";

type Tone =
  | "role" | "admin" | "on" | "off" | "new" | "update" | "error"
  | "status-present" | "status-excused" | "status-optional" | "status-absent";

export function Pill({
  tone,
  className = "",
  ...rest
}: { tone?: Tone } & HTMLAttributes<HTMLSpanElement>) {
  const cls = ["pill", tone ?? "", className].filter(Boolean).join(" ");
  return <span className={cls} {...rest} />;
}
