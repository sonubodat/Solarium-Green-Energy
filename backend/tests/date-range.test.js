import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDateRange, dateRangeFilter, dateRangeFileSuffix } from '../src/lib/date-range.js';

const bad = (query) => assert.throws(() => parseDateRange(query), (error) => error.statusCode === 400 && error.code === 'INVALID_DATE_RANGE');

test('no dates means all time', () => {
	assert.equal(parseDateRange({}), null);
	assert.equal(parseDateRange({ from: '', to: '' }), null);
	assert.equal(dateRangeFilter(null), undefined);
	assert.equal(dateRangeFileSuffix(null), '');
});

test('a day is an Indian (IST) calendar day, and "to" includes the whole day', () => {
	const range = parseDateRange({ from: '2026-10-01', to: '2026-10-07' });
	assert.equal(range.gte.toISOString(), '2026-09-30T18:30:00.000Z');
	assert.equal(range.lt.toISOString(), '2026-10-07T18:30:00.000Z');
	// 23:50 IST on 7 Oct is still in; 00:00 IST on 8 Oct is out
	const within = (iso) => { const t = new Date(iso); return t >= range.gte && t < range.lt; };
	assert.equal(within('2026-10-07T18:20:00Z'), true);
	assert.equal(within('2026-10-07T18:30:00Z'), false);
	assert.equal(within('2026-09-30T18:29:00Z'), false);
	assert.equal(within('2026-09-30T18:30:00Z'), true);
});

test('same day, only from, only to', () => {
	const day = parseDateRange({ from: '2026-10-05', to: '2026-10-05' });
	assert.equal(day.lt.getTime() - day.gte.getTime(), 24 * 60 * 60 * 1000);
	assert.deepEqual(Object.keys(dateRangeFilter(parseDateRange({ from: '2026-10-05' }))), ['gte']);
	assert.deepEqual(Object.keys(dateRangeFilter(parseDateRange({ to: '2026-10-05' }))), ['lt']);
});

test('invalid input is rejected with 400 INVALID_DATE_RANGE', () => {
	bad({ from: '2026-10-08', to: '2026-10-07' });
	bad({ from: '2026-02-31' });
	bad({ to: '2026-13-01' });
	bad({ from: 'yesterday' });
	bad({ from: '2026-1-5' });
	bad({ from: '2026-10-01T00:00:00Z' });
	parseDateRange({ from: '2028-02-29' }); // a real leap day is fine
});

test('file name suffix', () => {
	assert.equal(dateRangeFileSuffix(parseDateRange({ from: '2026-10-01', to: '2026-10-07' })), '_2026-10-01_to_2026-10-07');
	assert.equal(dateRangeFileSuffix(parseDateRange({ from: '2026-10-01' })), '_from_2026-10-01');
	assert.equal(dateRangeFileSuffix(parseDateRange({ to: '2026-10-07' })), '_until_2026-10-07');
});
