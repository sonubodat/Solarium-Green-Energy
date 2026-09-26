// Pure helpers for the Admin "Auto-QR posters" panel (components/AutoPosterModal.js).

// Where the chosen poster template is remembered. Per browser on purpose (no server setting, no
// database change): it only pre-selects the dropdown, the server still checks the template.
export const POSTER_TEMPLATE_STORAGE_KEY = 'solarium:auto-poster-template';

// The template that is "already selected" when the panel opens: the one this browser used last if it
// is still published, otherwise the newest published template (the templates list is newest first).
// Draft, archived and deleted templates are never selected. '' when there is nothing to print with.
export function pickDefaultTemplate(templates, storedId) {
  const published = templates.filter((template) => template.status === 'PUBLISHED');
  return (published.find((template) => template.id === storedId) || published[0])?.id || '';
}

// Splits the codes into print batches of at most `size` (the server's per-batch cap), keeping order.
export function splitIntoPosterBatches(codes, size) {
  const batches = [];
  for (let start = 0; start < codes.length; start += size) {
    const slice = codes.slice(start, start + size);
    batches.push({ index: batches.length, codes: slice, first: slice[0], last: slice[slice.length - 1] });
  }
  return batches;
}
