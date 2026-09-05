export default function Status() {
  return (
    <section className="view">
      <div className="soon-card glass">
        <h1>Datadog Observability</h1>
        <p className="muted">
          A live view of which Datadog products are enabled (and why any aren't) — coming in a later
          phase, backed by <code>/api/status</code>.
        </p>
      </div>
    </section>
  );
}
