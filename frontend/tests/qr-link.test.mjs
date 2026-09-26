// Run: node --test frontend/tests/qr-link.test.mjs   (no browser, no backend)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const copy = path.join(os.tmpdir(), `qr-link-under-test-${process.pid}.mjs`);
fs.copyFileSync(path.join(here, '../src/lib/qr-link.js'), copy); // .js is CommonJS here; .mjs loads as ESM
const { cleanQrCodeParam, shareBody, whatsappHref, smsHref, mailtoHref } = await import(pathToFileURL(copy));

test('cleanQrCodeParam: a clean code is unchanged, lower/upper case is left to the server', () => {
  assert.equal(cleanQrCodeParam('V-1148'), 'V-1148');
  assert.equal(cleanQrCodeParam('  V-1148  '), 'V-1148');
});

test('cleanQrCodeParam: rescues the mangled link the share text used to produce', () => {
  // router-decoded param of /v/V-1148%20Interested%20in%20solar?%20Get%20a%20free%20consultation...
  assert.equal(cleanQrCodeParam('V-1148 Interested in solar'), 'V-1148');
  // still encoded (or double-encoded by hand)
  assert.equal(cleanQrCodeParam('V-1148%20Interested%20in%20solar'), 'V-1148');
  assert.equal(cleanQrCodeParam('V-1148%0AInterested'), 'V-1148');
});

test('cleanQrCodeParam: a stray % does not throw, empty stays empty', () => {
  assert.equal(cleanQrCodeParam('V-12%ZZ'), 'V-12%ZZ');
  assert.equal(cleanQrCodeParam(''), '');
  assert.equal(cleanQrCodeParam(undefined), '');
  assert.equal(cleanQrCodeParam('   '), '');
});

test('shareBody: the link is alone on the last line, nothing follows it, the URL has no whitespace', () => {
  const url = 'https://portal.solariumenergy.in/v/V-1148';
  const body = shareBody('Test Store', url);
  assert.equal(body, `Interested in solar? Get a free consultation through Test Store:\n${url}`);
  const lines = body.split('\n');
  assert.equal(lines.at(-1), url);
  assert.ok(!/\s/.test(lines.at(-1)));
  assert.match(shareBody('', url), /through Solarium Energy:/);
});

test('direct share links carry the whole body, correctly encoded', () => {
  const body = shareBody('Test Store', 'https://portal.solariumenergy.in/v/V-1148');
  assert.equal(decodeURIComponent(whatsappHref(body).split('text=')[1]), body);
  assert.equal(decodeURIComponent(smsHref(body).split('body=')[1]), body);
  const mail = mailtoHref(body);
  assert.match(mail, /^mailto:\?subject=Get%20a%20free%20solar%20consultation&body=/);
  assert.equal(decodeURIComponent(mail.split('&body=')[1]), body);
  assert.ok(whatsappHref(body).startsWith('https://wa.me/?text='));
  assert.ok(smsHref(body).startsWith('sms:?&body='));
});
