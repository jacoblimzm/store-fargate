import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { currency, formatDate } from "../format";
import type { Account, Transaction } from "../types";

export default function AccountDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [account, setAccount] = useState<Account | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    const accountId = Number(id);
    if (!accountId) return;
    api
      .transactions(accountId)
      .then((res) => {
        setAccount(res.account);
        setTransactions(res.transactions);
      })
      .catch(() => navigate("/", { replace: true }));
  }, [id, navigate]);

  if (!account) return null;

  return (
    <section className="view">
      <button className="btn btn-ghost" onClick={() => navigate("/")}>&larr; Back to accounts</button>
      <div className="card account-summary">
        <div>
          <p className="muted">{account.accountType.toUpperCase()}</p>
          <p className="account-number">•••• {account.accountNumber.slice(-4)}</p>
        </div>
        <div className="balance">
          <p className="muted">Balance</p>
          <p className="balance-amount">{currency(account.balance)}</p>
        </div>
      </div>
      <h2>Transaction history</h2>
      <table className="tx-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th className="right">Amount</th>
            <th className="right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => {
            const signed = tx.kind === "credit" ? tx.amount : -tx.amount;
            return (
              <tr key={tx.id}>
                <td>{formatDate(tx.createdAt)}</td>
                <td>{tx.description}</td>
                <td className={`right ${tx.kind}`}>{signed >= 0 ? "+" : ""}{currency(signed)}</td>
                <td className="right">{currency(tx.balanceAfter)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
