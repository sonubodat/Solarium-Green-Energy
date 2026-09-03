import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseQrRange,
  buildQrCodeSequence,
  isValidQrCode,
} from '../src/services/qr-print.js';

test('parseQrRange accepts valid start and end QR codes', () => {
  const range = parseQrRange('V-0001', 'V-0004');
  assert.deepEqual(range, { start: 'V-0001', end: 'V-0004', startNumber: 1, endNumber: 4 });
});

test('parseQrRange rejects reversed ranges', () => {
  assert.throws(() => parseQrRange('V-0005', 'V-0002'), /start.*before.*end/i);
});

test('buildQrCodeSequence returns the expected ordered list', () => {
  const sequence = buildQrCodeSequence('V-0001', 'V-0003');
  assert.deepEqual(sequence, ['V-0001', 'V-0002', 'V-0003']);
});

test('isValidQrCode accepts the app QR format', () => {
  assert.equal(isValidQrCode('V-0049'), true);
  assert.equal(isValidQrCode('X-0049'), false);
});
