import type { HTMLAttributes } from "react";

function cx(base: string, extra?: string) {
  return extra ? `${base} ${extra}` : base;
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("card", className)} {...rest} />;
}

function Head({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("card-head", className)} {...rest} />;
}

Card.Head = Head;
