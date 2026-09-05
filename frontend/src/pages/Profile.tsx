import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { currency, initials } from "../format";
import { Avatar } from "../components/ui/Avatar";
import type { Account } from "../types";

const MENU = ["Security & devices", "Payment methods", "Notifications"];

export default function Profile() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    api.accounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  const fullName = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();
  const total = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const memberSince = user?.createdAt
    ? new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long" })
    : "—";

  const logout = () => {
    signOut();
    navigate("/login", { replace: true });
  };

  return (
    <section className="view">
      <button className="btn btn-ghost" onClick={() => navigate("/")}>&larr; Back</button>

      <div className="profile-card glass">
        <div className="profile-head">
          <Avatar text={initials(user?.firstName, user?.lastName)} size="xl" />
          <div className="profile-identity">
            <h1>{fullName || "Profile"}</h1>
            <p className="muted">{user?.email}</p>
          </div>
        </div>
        <span className="kyc-pill">KYC verified</span>
        <dl className="profile-details">
          <div className="profile-row">
            <dt>Full name</dt>
            <dd>{fullName || "—"}</dd>
          </div>
          <div className="profile-row">
            <dt>Email</dt>
            <dd>{user?.email || "—"}</dd>
          </div>
          <div className="profile-row">
            <dt>Member since</dt>
            <dd>{memberSince}</dd>
          </div>
          <div className="profile-row">
            <dt>Accounts</dt>
            <dd>{accounts.length}</dd>
          </div>
          <div className="profile-row">
            <dt>Total balance</dt>
            <dd>{currency(total)}</dd>
          </div>
        </dl>
      </div>

      <div className="menu-card glass">
        {MENU.map((label) => (
          <button key={label} type="button" className="menu-row">
            <span>{label}</span>
            <span className="menu-chevron" aria-hidden="true">›</span>
          </button>
        ))}
      </div>

      <button type="button" className="btn btn-logout" onClick={logout}>Log out</button>
    </section>
  );
}
