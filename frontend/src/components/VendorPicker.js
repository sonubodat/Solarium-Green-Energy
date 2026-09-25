import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './VendorPicker.css';

const SEARCH_DEBOUNCE_MS = 300;
const PAGE_SIZE = 10;

// A searchable, paginated Solar Mitra picker. It replaces a <select>, which cannot cope with
// hundreds of options: results are fetched from the server only when the picker is opened,
// then again for every search or page change — there is no cache across opens, so a Solar
// Mitra created or assigned a moment ago is always current, and nothing is requested until
// someone actually opens it (a table can hold 50 pickers at no cost).
//
// valueLabel (optional) names a `value` the parent set without going through the list.
// fetchPage(search, page, limit) must resolve to { vendors, pagination: { page, limit, total } }.
// recentCount (optional) is for pickers whose fetchPage returns newest-first: it is the page size,
// and while the search box is empty only that first page is shown (no paging through the whole
// list) — typing a search brings normal paging back, so every Solar Mitra stays reachable.
// This component only narrows what a user is OFFERED; it is not an authorization boundary —
// the server re-checks every id it receives.
function VendorPicker({ fetchPage, value, valueLabel, onChange, placeholder = 'Select Solar Mitra', disabled = false, ariaLabel, recentCount }) {
  const instanceId = useId();
  const listId = `${instanceId}-list`;
  const pageSize = recentCount || PAGE_SIZE;

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [text, setText] = useState('');
  // search + page live in ONE object and change together, so a new search can never be paired
  // with the previous search's page number (no request is made for a page-5 of the new query).
  const [query, setQuery] = useState({ search: '', page: 1 });
  const [result, setResult] = useState({ vendors: [], total: 0, limit: pageSize, loading: false, error: '' });
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState(null);

  const buttonRef = useRef(null);
  const popoverRef = useRef(null);
  const inputRef = useRef(null);
  const requestSeq = useRef(0);
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;

  // The parent clearing the value (e.g. after a successful assignment) clears the label too.
  useEffect(() => {
    if (!value) setSelected(null);
  }, [value]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }, []);

  function openPicker() {
    if (disabled) return;
    setText('');
    setQuery({ search: '', page: 1 });
    setActiveIndex(-1);
    setOpen(true);
  }

  // Debounce typing; a new search always returns to page 1.
  useEffect(() => {
    if (!open) return undefined;
    const trimmed = text.trim();
    if (trimmed === query.search) return undefined;
    const timer = setTimeout(() => setQuery({ search: trimmed, page: 1 }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, open, query.search]);

  // Fetch on open and whenever the (search, page) pair changes. A response is applied only if
  // it belongs to the most recent request, so a slow earlier search can never overwrite the
  // results of a later one.
  useEffect(() => {
    if (!open) return undefined;
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setResult((current) => ({ ...current, loading: true, error: '' }));
    fetchPageRef.current(query.search, query.page, pageSize)
      .then((data) => {
        if (seq !== requestSeq.current) return;
        setResult({
          vendors: data.vendors || [],
          total: data.pagination?.total ?? 0,
          limit: data.pagination?.limit ?? pageSize,
          loading: false,
          error: '',
        });
        setActiveIndex(-1);
      })
      .catch((error) => {
        if (seq !== requestSeq.current) return;
        setResult((current) => ({ ...current, vendors: [], total: 0, loading: false, error: error?.message || 'Could not load Solar Mitras.' }));
      });
    return () => {
      // Invalidate an in-flight request when the picker closes or the query changes again.
      requestSeq.current += 1;
    };
  }, [open, query, pageSize]);

  // Portalled to <body> with fixed positioning: the QR table sits inside an overflow container
  // that would otherwise clip an absolutely-positioned dropdown.
  const reposition = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, window.innerWidth - 16);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    // A compact popup on every screen size: open on whichever side has more room (below unless
    // it would be cramped), and cap its height to that room so it never spills off a small window.
    const openUp = spaceBelow < 300 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(180, Math.min(390, openUp ? spaceAbove : spaceBelow));
    setPosition({ left, width, maxHeight, ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  // The popover mounts one render after `open` (it waits for its measured position), so focus
  // the search box when it actually appears rather than in the open effect.
  const popoverMounted = open && position !== null;
  useEffect(() => {
    if (popoverMounted) inputRef.current?.focus();
  }, [popoverMounted]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointerDown(event) {
      if (popoverRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      close(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open, close]);

  function choose(vendor) {
    setSelected(vendor);
    onChange(vendor.id, vendor);
    close();
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, result.vendors.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter' && activeIndex >= 0 && result.vendors[activeIndex]) {
      event.preventDefault();
      choose(result.vendors[activeIndex]);
    }
  }

  const totalPages = Math.max(1, Math.ceil(result.total / result.limit));
  const firstShown = result.total === 0 ? 0 : (query.page - 1) * result.limit + 1;
  const lastShown = Math.min(query.page * result.limit, result.total);
  const recentOnly = Boolean(recentCount) && !query.search;
  const footerText = recentOnly && result.total > lastShown
    ? `Newest ${lastShown} of ${result.total} · type to search the rest`
    : `Showing ${firstShown}–${lastShown} of ${result.total}`;
  // valueLabel lets a parent that set `value` itself (e.g. just after creating a Solar Mitra)
  // show that name before anything has been picked from the list.
  const label = selected?.businessName || (value ? valueLabel || 'Selected Solar Mitra' : placeholder);

  return (
    <div className="vendor-picker">
      <button
        ref={buttonRef}
        type="button"
        className={`vendor-picker-button${selected ? ' has-value' : ''}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openPicker())}
      >
        <span className="vendor-picker-label">{label}</span>
        <span className="vendor-picker-caret" aria-hidden="true">▾</span>
      </button>
      {value && !disabled && (
        <button type="button" className="vendor-picker-clear" aria-label="Clear selected Solar Mitra" onClick={() => onChange('', null)}>
          ×
        </button>
      )}

      {open && position && createPortal(
        <>
          {/* React bubbles events from a portal up the React tree, not the DOM tree, so clicks
              here are stopped: otherwise a picker inside a modal or a <label> would also fire
              that ancestor's onClick (closing the modal, or re-clicking the label's control). */}
          <div className="vendor-picker-backdrop" onMouseDown={() => close(false)} onClick={(event) => event.stopPropagation()} />
          <div
            ref={popoverRef}
            className="vendor-picker-popover"
            style={position}
            role="dialog"
            aria-label="Choose a Solar Mitra"
            onKeyDown={handleKeyDown}
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              className="vendor-picker-search"
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
              placeholder="Search name, phone or login ID..."
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />

            <ul id={listId} className="vendor-picker-list" role="listbox" aria-busy={result.loading}>
              {result.error ? (
                <li className="vendor-picker-message" role="alert">
                  {result.error}{' '}
                  <button type="button" className="vendor-picker-link" onClick={() => setQuery((current) => ({ ...current }))}>Retry</button>
                </li>
              ) : result.vendors.length ? (
                result.vendors.map((vendor, index) => (
                  <li
                    key={vendor.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={vendor.id === value}
                    className={`vendor-picker-option${index === activeIndex ? ' active' : ''}${vendor.id === value ? ' selected' : ''}`}
                    onMouseEnter={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(vendor)}
                  >
                    <strong>{vendor.businessName}</strong>
                    <small>
                      {vendor.loginIdentifier}
                      {vendor.mobileNumber && vendor.mobileNumber !== vendor.loginIdentifier ? ` · ${vendor.mobileNumber}` : ''}
                      {vendor.ownerName && vendor.ownerName !== vendor.businessName ? ` · ${vendor.ownerName}` : ''}
                    </small>
                  </li>
                ))
              ) : result.loading ? (
                <li className="vendor-picker-message">Loading Solar Mitras...</li>
              ) : (
                <li className="vendor-picker-message">
                  {query.search ? `No Solar Mitras match "${query.search}".` : 'No Solar Mitras available.'}
                </li>
              )}
            </ul>

            <div className="vendor-picker-footer">
              <span aria-live="polite">
                {result.total ? footerText :' '}
              </span>
              {!recentOnly && (
                <span className="vendor-picker-pager">
                  <button
                    type="button"
                    disabled={query.page <= 1 || result.loading}
                    onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}
                  >
                    Prev
                  </button>
                  <button
                    type="button"
                    disabled={query.page >= totalPages || result.loading}
                    onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}
                  >
                    Next
                  </button>
                </span>
              )}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

export default VendorPicker;
