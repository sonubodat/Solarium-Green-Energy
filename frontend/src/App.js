import { useState } from 'react';
import './App.css';

const views = {
  Public: {
    eyebrow: 'Customer referral',
    title: 'A simpler path to solar',
    description: 'Connect with Solarium Energy through your local referral partner.',
    action: 'Start an enquiry',
    items: [
      ['Referral source', 'Local partner'],
      ['Referral QR', 'Active'],
      ['Enquiry', 'Not started'],
    ],
  },
  Vendor: {
    eyebrow: 'Vendor portal',
    title: 'Your referral workspace',
    description: 'Keep track of referrals and payout status in one quiet, focused view.',
    action: 'View referrals',
    items: [
      ['Business', 'Ram Store'],
      ['Referral access', 'Active'],
      ['Payout status', 'Unpaid'],
    ],
  },
  Sales: {
    eyebrow: 'Sales portal',
    title: 'Onboarding, without the noise',
    description: 'Work through assigned registrations and activate the next unassigned QR.',
    action: 'Activate a QR',
    items: [
      ['Assigned work', 'Ready for review'],
      ['Vendor onboarding', 'In progress'],
      ['QR inventory', 'Unassigned'],
    ],
  },
  Admin: {
    eyebrow: 'Admin portal',
    title: 'System control, clearly arranged',
    description: 'Manage vendors, QR assignments, leads, payouts, and audit history.',
    action: 'Open vendor management',
    items: [
      ['Vendor records', 'Review required'],
      ['QR assignments', 'Active'],
      ['Payout records', 'Unpaid'],
    ],
  },
};

function App() {
  const [activeView, setActiveView] = useState('Public');
  const view = views[activeView];

  return (
    <main className="App">
      <nav className="topbar" aria-label="Solarium navigation">
        <div className="brand"><span className="brand-mark">S</span><span>solarium<span className="brand-accent">/</span>energy</span></div>
        <span className="environment">Frontend preview</span>
      </nav>

      <section className="workspace">
        <aside className="sidebar">
          <p className="sidebar-label">View as</p>
          <div className="view-switcher" role="tablist" aria-label="Portal views">
            {Object.keys(views).map((name) => (
              <button
                className={activeView === name ? 'view-tab active' : 'view-tab'}
                key={name}
                onClick={() => setActiveView(name)}
                role="tab"
                aria-selected={activeView === name}
              >
                <span className="tab-dot" />{name}
              </button>
            ))}
          </div>
          <p className="sidebar-note">Connected to the Solarium API on port 4000.</p>
        </aside>

        <section className="content" role="tabpanel">
          <div className="content-header">
            <span className="status-pill"><span className="live-dot" /> {activeView} space</span>
            <span className="route-label">/{activeView.toLowerCase()}</span>
          </div>
          <div className="hero-copy">
            <p className="eyebrow">{view.eyebrow}</p>
            <h1>{view.title}</h1>
            <p className="description">{view.description}</p>
            <button className="primary-action">{view.action}<span aria-hidden="true"> -&gt;</span></button>
          </div>
          <div className="status-list">
            {view.items.map(([label, status]) => (
              <div className="status-row" key={label}>
                <span>{label}</span><strong>{status}</strong>
              </div>
            ))}
          </div>
          <p className="preview-note">Preview state only. Authentication and live data are connected in the next implementation phases.</p>
        </section>
      </section>
    </main>
  );
}

export default App;
