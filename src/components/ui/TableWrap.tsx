import type { HTMLAttributes } from "react";

export function TableWrap({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  const cls = ["tablewrap", className].filter(Boolean).join(" ");
  return <div className={cls} {...rest} />;
}
