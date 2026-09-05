export const currency = (n: number): string =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export const formatDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "";

export function initials(firstName?: string, lastName?: string): string {
  const a = (firstName || "").trim()[0] || "";
  const b = (lastName || "").trim()[0] || "";
  return (a + b).toUpperCase() || "?";
}
