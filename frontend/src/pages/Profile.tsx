import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { currency, initials } from "../format";
import type { Account } from "../types";

export default function Profile() {
  const { user } = useAuth();
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

  return (
    <section className="view">
      <button className="btn btn-ghost" onClick={() => navigate("/")}>&larr; Back to accounts</button>
      <div className="card profile-card">
        <div className="profile-head">
          <span className="avatar avatar-xl" aria-hidden="true">{initials(user?.firstName, user?.lastName)}</span>
          <div className="profile-identity">
            <h1>{fullName || "Profile"}</h1>
            <p className="muted">{user?.email}</p>
          </div>
        </div>
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
    </section>
  );
}
