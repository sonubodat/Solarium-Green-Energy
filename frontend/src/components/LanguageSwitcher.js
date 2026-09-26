import { useEffect, useRef, useState } from 'react';
import { LANGUAGES } from '../lib/vendor-i18n';

// "🌐 English ▾" button that opens English / ગુજરાતી / हिन्दी. Styles live in VendorPage.css (.vendor-lang*).
// Only VendorPage renders it: `language` is the current code, `onChange(code)` applies and remembers it.
function LanguageSwitcher({ language, onChange, label }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const current = LANGUAGES.find((item) => item.code === language) || LANGUAGES[0];

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutside = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('touchstart', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('touchstart', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  function choose(code) {
    setOpen(false);
    if (code !== language) onChange(code);
    buttonRef.current?.focus();
  }

  return (
    <div className="vendor-lang" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="vendor-lang-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${current.label}`}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" />
        </svg>
        <span lang={current.code}>{current.label}</span>
        <svg className="vendor-lang-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="vendor-lang-menu" role="menu" aria-label={label}>
          {LANGUAGES.map((item) => (
            <button
              key={item.code}
              type="button"
              role="menuitemradio"
              aria-checked={item.code === language}
              lang={item.code}
              onClick={() => choose(item.code)}
            >
              {item.label}
              {item.code === language && (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default LanguageSwitcher;
