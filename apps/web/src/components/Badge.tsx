import type { ReactNode } from "react";

export function Badge(props: { intent: string; label: string }): ReactNode {
  return <span className={`badge ${props.intent}`}>{props.label}</span>;
}
