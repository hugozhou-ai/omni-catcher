import type { ReactNode } from "react";

export type IconName =
  | "bookmark"
  | "capture"
  | "check"
  | "checkMark"
  | "chevronLeft"
  | "chevronRight"
  | "document"
  | "grid"
  | "info"
  | "list"
  | "menu"
  | "search"
  | "settings"
  | "spark"
  | "stop"
  | "trash"
  | "warning";

export function Icon(props: { name: IconName; className?: string }): ReactNode {
  const { name, className = "icon" } = props;
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {pathFor(name)}
    </svg>
  );
}

function pathFor(name: IconName): ReactNode {
  switch (name) {
    case "bookmark":
      return (
        <>
          <path d="M4 4h16v16H4V4Z" />
          <path d="M8 7h8v8l-4-2-4 2V7Z" />
        </>
      );
    case "capture":
      return (
        <>
          <path d="M6 8V6h2" />
          <path d="M16 6h2v2" />
          <path d="M18 16v2h-2" />
          <path d="M8 18H6v-2" />
          <path d="M8 12h8" />
          <path d="M12 8v8" />
        </>
      );
    case "check":
      return (
        <>
          <path d="M4 4h16v16H4V4Z" />
          <path d="m8 12 2.8 2.8L16.5 9" />
        </>
      );
    case "checkMark":
      return <path d="m6 12 4 4 8-8" />;
    case "chevronLeft":
      return <path d="M14 6l-6 6 6 6" />;
    case "chevronRight":
      return <path d="M10 6l6 6-6 6" />;
    case "document":
      return (
        <>
          <path d="M4 4h12l4 4v12H4V4Z" />
          <path d="M16 4v4h4" />
          <path d="M8 12h8" />
          <path d="M8 15h6" />
        </>
      );
    case "grid":
      return (
        <>
          <path d="M4 4h6v6H4V4Z" />
          <path d="M14 4h6v6h-6V4Z" />
          <path d="M4 14h6v6H4v-6Z" />
          <path d="M14 14h6v6h-6v-6Z" />
        </>
      );
    case "info":
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 10v5" />
          <path d="M12 7.5h.01" />
        </>
      );
    case "list":
      return (
        <>
          <path d="M8 6h12" />
          <path d="M8 12h12" />
          <path d="M8 18h12" />
          <path d="M4 6h2" />
          <path d="M4 12h2" />
          <path d="M4 18h2" />
        </>
      );
    case "menu":
      return (
        <>
          <path d="M5 7h14" />
          <path d="M5 12h14" />
          <path d="M5 17h14" />
        </>
      );
    case "search":
      return (
        <>
          <circle cx="10" cy="10" r="6" />
          <path d="m14 14 6 6" />
        </>
      );
    case "settings":
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2" />
          <path d="M12 19v2" />
          <path d="M3 12h2" />
          <path d="M19 12h2" />
          <path d="m5.6 5.6 1.4 1.4" />
          <path d="m17 17 1.4 1.4" />
          <path d="m18.4 5.6-1.4 1.4" />
          <path d="m7 17-1.4 1.4" />
        </>
      );
    case "spark":
      return (
        <>
          <path d="M12 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6Z" />
          <path d="M18 4l2 2-2 2-2-2 2-2Z" />
        </>
      );
    case "stop":
      return <path d="M7 7h10v10H7V7Z" />;
    case "trash":
      return (
        <>
          <path d="M7 8h10v11H7V8Z" />
          <path d="M5 8h14" />
          <path d="M9 8V5h6v3" />
          <path d="M10 11v5" />
          <path d="M14 11v5" />
        </>
      );
    case "warning":
      return (
        <>
          <path d="M12 4 3 19h18L12 4Z" />
          <path d="M12 10v4" />
          <path d="M12 16.5h.01" />
        </>
      );
    default:
      return null;
  }
}
