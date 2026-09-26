// Pure (no database) helpers for the Admin "Auto-QR posters" flow, so they can be tested without a server.

// V-1148 < V-10000: compare the numbers, not the strings. Anything that is not V-#### sorts last.
export function qrCodeNumber(code) {
	const match = String(code).match(/^V-(\d+)$/);
	return match ? Number(match[1]) : Infinity;
}

export function sortQrCodesNumerically(codes) {
	return [...codes].sort((first, second) => {
		const difference = qrCodeNumber(first) - qrCodeNumber(second);
		if (Number.isNaN(difference) || difference === 0) return String(first).localeCompare(String(second));
		return difference;
	});
}

// Normalizes what an admin (or a stale browser tab) may send: trims, upper-cases, pads V-12 to V-0012,
// drops duplicates and blanks. The caller still verifies every code against the database.
export function normalizeQrCodeList(rawCodes) {
	const seen = new Set();
	for (const raw of rawCodes) {
		const normalized = String(raw || '').trim().toUpperCase();
		const match = normalized.match(/^V-(\d+)$/);
		if (match) seen.add(`V-${match[1].padStart(4, '0')}`);
		else if (normalized) seen.add(normalized);
	}
	return sortQrCodesNumerically([...seen]);
}

// The immutable copy of a template stored on a print job (what the proof and the production PDF are
// composed from, so a later template edit can never change an already-approved batch). Same fields as
// the range-based POST /admin/qr/print-batch stores.
export function buildTemplateSnapshot(template) {
	return {
		id: template.id,
		version: template.version,
		name: template.name,
		artworkPath: template.artworkPath,
		artworkMimeType: template.artworkMimeType,
		pageWidthMm: template.pageWidthMm,
		pageHeightMm: template.pageHeightMm,
		dpi: template.dpi,
		qrX: template.qrX,
		qrY: template.qrY,
		qrWidth: template.qrWidth,
		qrHeight: template.qrHeight,
		labelEnabled: template.labelEnabled,
		labelTextX: template.labelTextX,
		labelTextY: template.labelTextY,
		labelFontSize: template.labelFontSize,
	};
}

// First, middle and last code of a batch: the pages the proof shows.
export function proofPreviewCodes(codes) {
	return [...new Set([codes[0], codes[Math.floor(codes.length / 2)], codes[codes.length - 1]].filter(Boolean))];
}
