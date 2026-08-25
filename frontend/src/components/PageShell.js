function PageShell({ routeLabel, statusLabel, eyebrow, title, description, children, statusItems }) {
  return (
    <main className="App">
      <nav className="topbar" aria-label="Solarium navigation">
        <div className="brand"><span className="brand-mark">S</span><span>solarium<span className="brand-accent">/</span>energy</span></div>
        <span className="environment">{routeLabel}</span>
      </nav>

      <section className="content" role="main">
        <div className="content-header">
          <span className="status-pill"><span className="live-dot" /> {statusLabel}</span>
          <span className="route-label">{routeLabel}</span>
        </div>
        <div className="hero-copy">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="description">{description}</p>
          {children}
        </div>
        {statusItems && (
          <div className="status-list">
            {statusItems.map(([label, status]) => (
              <div className="status-row" key={label}>
                <span>{label}</span><strong>{status}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default PageShell;
