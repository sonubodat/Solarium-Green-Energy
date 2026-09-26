import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTemplateSnapshot, normalizeQrCodeList, proofPreviewCodes, qrCodeNumber, sortQrCodesNumerically } from '../src/lib/auto-poster.js';

test('QR codes sort by number, not as text (V-10000 comes after V-9999)', () => {
	assert.equal(qrCodeNumber('V-1148'), 1148);
	assert.deepEqual(sortQrCodesNumerically(['V-10000', 'V-9999', 'V-1148', 'V-0007']), ['V-0007', 'V-1148', 'V-9999', 'V-10000']);
	assert.deepEqual(['V-10000', 'V-9999'].sort(), ['V-10000', 'V-9999']); // the plain string sort this avoids
});

test('normalizeQrCodeList: pads, upper-cases, de-duplicates, drops blanks, sorts numerically', () => {
	assert.deepEqual(normalizeQrCodeList([' v-12 ', 'V-0012', 'V-1148', '', null, undefined, 'v-7']), ['V-0007', 'V-0012', 'V-1148']);
	// anything that is not V-#### is kept as typed so the database check can reject it by name
	assert.deepEqual(normalizeQrCodeList(['company-import', 'V-0001']), ['V-0001', 'COMPANY-IMPORT']);
});

test('buildTemplateSnapshot copies exactly the fields the proof and PDF are composed from', () => {
	const template = {
		id: 't1', version: 3, name: 'Poster A', artworkPath: 'a.png', artworkMimeType: 'image/png', pageWidthMm: 210, pageHeightMm: 297, dpi: 300,
		qrX: 10, qrY: 20, qrWidth: 50, qrHeight: 50, labelEnabled: true, labelTextX: 5, labelTextY: 6, labelFontSize: 9,
		status: 'PUBLISHED', createdById: 'u1', createdAt: new Date(), updatedAt: new Date(),
	};
	const snapshot = buildTemplateSnapshot(template);
	assert.deepEqual(Object.keys(snapshot).sort(), [
		'artworkMimeType', 'artworkPath', 'dpi', 'id', 'labelEnabled', 'labelFontSize', 'labelTextX', 'labelTextY', 'name',
		'pageHeightMm', 'pageWidthMm', 'qrHeight', 'qrWidth', 'qrX', 'qrY', 'version',
	]);
	assert.equal(snapshot.name, 'Poster A');
	assert.ok(!('status' in snapshot) && !('createdById' in snapshot));
});

test('proofPreviewCodes: first, middle and last, collapsing for tiny batches', () => {
	assert.deepEqual(proofPreviewCodes(['V-1', 'V-2', 'V-3', 'V-4', 'V-5']), ['V-1', 'V-3', 'V-5']);
	assert.deepEqual(proofPreviewCodes(['V-1', 'V-2']), ['V-1', 'V-2']);
	assert.deepEqual(proofPreviewCodes(['V-1']), ['V-1']);
});
