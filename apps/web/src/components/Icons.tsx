import type { ReactNode } from "react";

export type IconName =
  | "bookmark"
  | "capture"
  | "check"
  | "chevronRight"
  | "document"
  | "grid"
  | "list"
  | "search"
  | "spark";

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
      return <path d="M7 4.75h10v14.5l-5-3.1-5 3.1V4.75Z" />;
    case "capture":
      return (
        <>
          <path d="M5 8.2V5.5h2.7" />
          <path d="M16.3 5.5H19v2.7" />
          <path d="M19 15.8v2.7h-2.7" />
          <path d="M7.7 18.5H5v-2.7" />
          <path d="M8.5 12h7" />
          <path d="M12 8.5v7" />
        </>
      );
    case "check":
      return (
        <>
          <path d="M8.2 12.4l2.4 2.4 5.2-5.6" />
          <path d="M5.5 4.75h13v14.5h-13V4.75Z" />
        </>
      );
    case "chevronRight":
      return <path d="M9.5 6.5 15 12l-5.5 5.5" />;
    case "document":
      return (
        <>
          <path d="M7 4.75h7.2L17 7.55v11.7H7V4.75Z" />
          <path d="M14 5v3h3" />
          <path d="M9.5 11h5" />
          <path d="M9.5 14h4" />
        </>
      );
    case "grid":
      return (
        <>
          <path d="M5 5h6v6H5V5Z" />
          <path d="M13 5h6v6h-6V5Z" />
          <path d="M5 13h6v6H5v-6Z" />
          <path d="M13 13h6v6h-6v-6Z" />
        </>
      );
    case "list":
      return (
        <>
          <path d="M8 7h11" />
          <path d="M8 12h11" />
          <path d="M8 17h11" />
          <path d="M5 7h.01" />
          <path d="M5 12h.01" />
          <path d="M5 17h.01" />
        </>
      );
    case "search":
      return (
        <>
          <path d="M10.8 17.1a6.3 6.3 0 1 1 0-12.6 6.3 6.3 0 0 1 0 12.6Z" />
          <path d="m15.4 15.4 4.1 4.1" />
        </>
      );
    case "spark":
      return (
        <>
          <path d="M12 3.75 13.5 9l4.75 1.5-4.75 1.5L12 17.25 10.5 12l-4.75-1.5L10.5 9 12 3.75Z" />
          <path d="m18.5 4.75.55 1.8 1.7.55-1.7.55-.55 1.8-.55-1.8-1.7-.55 1.7-.55.55-1.8Z" />
        </>
      );
    default:
      return null;
  }
}
