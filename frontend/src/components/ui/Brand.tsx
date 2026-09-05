// DCash logo tile — a fixed, rounded square in the hero gradient. It's a clean
// placeholder: pass `src` (or later swap the default glyph for an inline SVG)
// to drop in a custom sleek logo without touching layout.
//   <Brand />                     -> gradient tile with the "D" monogram
//   <Brand src="/logo.svg" />     -> gradient tile with a custom image
export function Brand({ src, alt = "DCash" }: { src?: string; alt?: string }) {
  return (
    <span className="brand-mark" aria-hidden={src ? undefined : "true"}>
      {src ? <img className="brand-mark-img" src={src} alt={alt} /> : "D"}
    </span>
  );
}
