import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveVendorPosterTemplate } from '../src/services/vendor-poster.js';

// A fake client that answers findFirst from an in-memory list, applying only the where/orderBy the resolver uses.
const fakeClient = (templates) => ({
	qrPrintTemplate: {
		findFirst: async ({ where, orderBy }) => {
			let rows = templates.filter((t) => t.status === where.status && (where.vendorPoster === undefined || t.vendorPoster === where.vendorPoster));
			if (orderBy) rows = [...rows].sort((a, b) => b.createdAt - a.createdAt);
			return rows[0] || null;
		},
	},
});
const t = (id, status, createdAt, vendorPoster = false) => ({ id, status, createdAt, vendorPoster });

test('the template Admin chose wins over a newer published one', async () => {
	const chosen = await resolveVendorPosterTemplate(fakeClient([t('old-chosen', 'PUBLISHED', 1, true), t('newer', 'PUBLISHED', 9)]));
	assert.equal(chosen.id, 'old-chosen');
});

test('with nothing chosen, the newest published template is used (the behaviour before this setting existed)', async () => {
	const chosen = await resolveVendorPosterTemplate(fakeClient([t('a', 'PUBLISHED', 1), t('b', 'PUBLISHED', 5), t('draft', 'DRAFT', 9)]));
	assert.equal(chosen.id, 'b');
});

test('a chosen template that was archived or unpublished falls back to the newest published one', async () => {
	const chosen = await resolveVendorPosterTemplate(fakeClient([t('retired', 'ARCHIVED', 3, true), t('a', 'PUBLISHED', 1), t('b', 'PUBLISHED', 2)]));
	assert.equal(chosen.id, 'b');
});

test('nothing published means no template', async () => {
	assert.equal(await resolveVendorPosterTemplate(fakeClient([t('d', 'DRAFT', 1, true)])), null);
});
