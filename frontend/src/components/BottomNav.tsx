import { useLocation, useNavigate } from "react-router-dom";

const ITEMS: Array<{ key: string; label: string; path: string }> = [
  { key: "home", label: "Home", path: "/" },
  { key: "lab", label: "Lab", path: "/lab" },
  { key: "profile", label: "Profile", path: "/profile" },
  { key: "status", label: "Status", path: "/status" },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const isActive = (path: string) => (path === "/" ? pathname === "/" : pathname.startsWith(path));

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          type="button"
          className={isActive(it.path) ? "active" : ""}
          onClick={() => navigate(it.path)}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
