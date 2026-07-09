import type { ReactNode } from "react";

export function Spinner(): ReactNode {
  return <span className="spinner" role="status" aria-label="Loading" />;
}
