import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { initials } from "../format";

export default function Header() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const areaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (open && areaRef.current && !areaRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const fullName = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  const ini = initials(user?.firstName, user?.lastName);

  const logout = () => {
    setOpen(false);
    signOut();
    navigate("/login", { replace: true });
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">◆</span> DCash
      </div>

      <div className="user-area" ref={areaRef}>
        <button
          className="user-btn"
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((v) => !v);
          }}
        >
          <span className="avatar" aria-hidden="true">{ini}</span>
          <span className="user-btn-meta">
            <span className="user-btn-name">{fullName}</span>
            <span className="user-btn-email">{user?.email}</span>
          </span>
          <span className="user-caret" aria-hidden="true">▾</span>
        </button>

        {open ? (
          <div className="user-menu" role="menu">
            <div className="user-menu-header">
              <span className="avatar avatar-lg" aria-hidden="true">{ini}</span>
              <span className="user-menu-identity">
                <span className="user-menu-name">{fullName}</span>
                <span className="user-menu-email">{user?.email}</span>
              </span>
            </div>
            <div className="user-menu-sep" role="separator" />
            <button
              className="user-menu-item"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate("/profile");
              }}
            >
              <span aria-hidden="true">👤</span> Account details
            </button>
            <button className="user-menu-item danger" type="button" role="menuitem" onClick={logout}>
              <span aria-hidden="true">⎋</span> Log out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
