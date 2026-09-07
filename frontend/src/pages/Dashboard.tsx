import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth";
import { currency, formatDate } from "../format";
import { miniApps } from "../miniapps/registry";
import { ServiceIcon } from "../components/ui/ServiceIcon";
import type { Account, Transaction } from "../types";

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);

  useEffect(() => {
    let active = true;
    api
      .accounts()
      .then((accts) => {
        if (!active) return;
        setAccounts(accts);
        const primary = accts[0];
        if (primary) {
          api
            .transactions(primary.id)
            .then((res) => active && setRecent(res.transactions.slice(0, 4)))
            .catch(() => {});
        }
      })
      .catch(() => setAccounts([]));
    return () => {
      active = false;
    };
  }, []);

  const total = accounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  const primary = accounts[0];
  const openPrimary = () => primary && navigate(`/accounts/${primary.id}`);

  return (
    <section className="view">
      <div className="welcome">
        <h1>Hi, {user?.firstName}</h1>
      </div>

      <button className="wallet" onClick={openPrimary} aria-label="View account activity">
        <div className="wallet-label">Total balance</div>
        <div className="wallet-balance">{currency(total)}</div>
        <div className="wallet-actions">
          <span
            className="wallet-btn ghost"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              navigate("/soon/pay");
            }}
          >
            + Top up
          </span>
          <span
            className="wallet-btn solid"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              navigate("/send");
            }}
          >
            Send
          </span>
          <span
            className="wallet-btn ghost"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              navigate("/receive");
            }}
          >
            Receive
          </span>
        </div>
      </button>

      <div className="section-label">Services</div>
      <div className="services-grid">
        {miniApps.map((m) => (
          <button
            key={m.key}
            className="tile glass"
            disabled={!m.enabled}
            onClick={() => m.enabled && navigate(m.route)}
          >
            <span className="tile-icon" aria-hidden="true"><ServiceIcon name={m.key} /></span>
            <span className="tile-label">{m.label}</span>
          </button>
        ))}
      </div>

      {recent.length > 0 ? (
        <>
          <div className="section-label">Recent activity</div>
          <div className="recent glass">
            {recent.map((tx) => {
              const signed = tx.kind === "credit" ? tx.amount : -tx.amount;
              return (
                <button key={tx.id} className="activity-row" onClick={openPrimary}>
                  <span className="activity-meta">
                    <span className="activity-desc">{tx.description}</span>
                    <span className="activity-date">{formatDate(tx.createdAt)}</span>
                  </span>
                  <span className={tx.kind}>{signed >= 0 ? "+" : ""}{currency(signed)}</span>
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
