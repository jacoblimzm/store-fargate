import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { currency } from "../format";
import type { Account } from "../types";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    api.accounts().then(setAccounts).catch(() => setAccounts([]));
  }, []);

  return (
    <section className="view">
      <div className="welcome">
        <h1>Welcome, {user?.firstName}</h1>
        <p className="muted">{user?.email}</p>
      </div>
      <h2>Your accounts</h2>
      <div className="account-grid">
        {accounts.map((acct) => (
          <button key={acct.id} className="account-card" onClick={() => navigate(`/accounts/${acct.id}`)}>
            <span className="account-type">{acct.accountType}</span>
            <span className="account-number">•••• {acct.accountNumber.slice(-4)}</span>
            <span className="balance-amount">{currency(acct.balance)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
