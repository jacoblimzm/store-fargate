import { useNavigate, useParams } from "react-router-dom";

const LABELS: Record<string, string> = {
  send: "Send money",
  pay: "Pay bills",
  bank: "Bank transfer",
  cards: "Cards",
  loans: "Loans",
  shop: "Marketplace",
  rides: "Mobility",
  more: "More services",
};

export default function ComingSoon() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const title = (name && LABELS[name]) || "This service";

  return (
    <section className="view">
      <button className="btn btn-ghost" onClick={() => navigate("/")}>&larr; Back</button>
      <div className="soon-card glass">
        <h1>{title}</h1>
        <p className="muted">Coming soon — this mini-app is next on the DCash roadmap.</p>
      </div>
    </section>
  );
}
