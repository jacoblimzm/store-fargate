// Three-point sparkle used by the Advisor (FAB + input + intro).
export function Spark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2.5c.4 2.9 1.6 4.1 4.5 4.5-2.9.4-4.1 1.6-4.5 4.5-.4-2.9-1.6-4.1-4.5-4.5 2.9-.4 4.1-1.6 4.5-4.5Z" />
      <path d="M18.5 12.5c.24 1.7.96 2.42 2.7 2.7-1.74.28-2.46 1-2.7 2.7-.24-1.7-.96-2.42-2.7-2.7 1.74-.28 2.46-1 2.7-2.7Z" />
      <path d="M7 14c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2Z" />
    </svg>
  );
}
