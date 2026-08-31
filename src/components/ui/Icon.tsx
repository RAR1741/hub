type IconName =
  | "edit"
  | "trash"
  | "plus"
  | "search"
  | "check"
  | "x"
  | "calendar"
  | "clock"
  | "users"
  | "eye"
  | "chevron"
  | "chevron-down"
  | "home"
  | "chart"
  | "tablet"
  | "wrench"
  | "layers"
  | "sliders";
const paths: Record<IconName, React.ReactNode> = {
  edit: <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z" />,
  trash: <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  check: <path d="M5 13l4 4L19 7" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.4" />
      <path d="M21 20c0-2.6-1.7-4.8-4-5.6" />
    </>
  ),
  eye: (
    <>
      <path d="M12 5C7 5 2.73 8.11 1 12.5c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5C21.27 8.11 17 5 12 5z" />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  "chevron-down": <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  home: (
    <>
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9v10.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9" />
      <path d="M9.5 20.5V14h5v6.5" />
    </>
  ),
  chart: <path d="M5.5 20V10M12 20V4M18.5 20v-6" />,
  tablet: (
    <>
      <rect x="4.5" y="2.5" width="15" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </>
  ),
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5z" />
      <path d="m3.5 14.5 8.5 4.7 8.5-4.7" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2M10.8 16.5H20" />
      <circle cx="15" cy="7.5" r="2.2" />
      <circle cx="8.5" cy="16.5" r="2.2" />
    </>
  ),
};

export function Icon({
  name,
  className,
  style,
}: {
  name: IconName;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
