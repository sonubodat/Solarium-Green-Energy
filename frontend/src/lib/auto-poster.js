// Pure helpers for the Admin "Auto-QR posters" panel (components/AutoPosterModal.js).

// The template that is "already selected" when the panel opens: the one Admin chose for Solar Mitra posters
// (stored on the server) if it is still published, otherwise the newest published template (the templates list is
// newest first). Draft, archived and deleted templates are never selected. '' when there is nothing to print with.
export function pickDefaultTemplate(templates, chosenId) {
  const published = templates.filter((template) => template.status === 'PUBLISHED');
  return (published.find((template) => template.id === chosenId) || published[0])?.id || '';
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
