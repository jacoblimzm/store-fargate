export function Avatar({ text, size }: { text: string; size?: "lg" | "xl" }) {
  return (
    <span className={`avatar${size ? ` avatar-${size}` : ""}`} aria-hidden="true">
      {text}
    </span>
  );
}
