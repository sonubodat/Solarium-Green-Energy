// Run: node --test frontend/tests/vendor-i18n.test.mjs   (no browser, no backend)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const copy = path.join(os.tmpdir(), `vendor-i18n-under-test-${process.pid}.mjs`);
fs.copyFileSync(path.join(here, '../src/lib/vendor-i18n.js'), copy); // .js is CommonJS here; .mjs loads as ESM
const {
  TRANSLATIONS, LANGUAGES, LANGUAGE_STORAGE_KEY, translate, translateStatus, loadLanguage, saveLanguage,
} = await import(pathToFileURL(copy));

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('every English key exists in Gujarati and Hindi with the same placeholders, and nothing extra', () => {
  const keys = Object.keys(TRANSLATIONS.en);
  for (const code of ['gu', 'hi']) {
    assert.deepEqual(Object.keys(TRANSLATIONS[code]).sort(), [...keys].sort(), `${code} keys differ from en`);
    for (const key of keys) {
      assert.ok(TRANSLATIONS[code][key].trim(), `${code} ${key} is empty`);
      assert.deepEqual(placeholders(TRANSLATIONS[code][key]), placeholders(TRANSLATIONS.en[key]), `${code} ${key} placeholders`);
    }
  }
});

test('the wording the brief asked for is used', () => {
  assert.equal(translate('gu', 'nav.overview'), 'ઝાંખી');
  assert.equal(translate('gu', 'ref.emptyTitle'), 'હજુ સુધી કોઈ રેફરલ નથી');
  assert.equal(translate('gu', 'acct.active'), 'એકાઉન્ટ સક્રિય છે');
  assert.equal(translate('hi', 'nav.payouts'), 'भुगतान');
  assert.equal(translate('hi', 'stats.paid'), 'भुगतान किए गए रेफ़रल');
  assert.equal(translate('hi', 'pw.set'), 'पासवर्ड सेट करें');
});

test('translate fills placeholders, falls back to English, then to the key', () => {
  assert.equal(translate('en', 'pay.referral', { id: 7 }), 'Referral #7');
  assert.equal(translate('gu', 'acct.assigned', { code: 'V-1148' }), 'સોંપેલ (V-1148)');
  assert.equal(translate('fr', 'nav.home'), 'Home');
  assert.equal(translate('gu', 'no.such.key'), 'no.such.key');
  assert.equal(translate('en', 'pay.referral'), 'Referral #{id}'); // no params: left as written
});

test('languages are English, Gujarati, Hindi by their own name, no flags', () => {
  assert.deepEqual(LANGUAGES.map((language) => language.label), ['English', 'ગુજરાતી', 'हिन्दी']);
});

test('translateStatus: known words follow the language, unknown text and English stay as sent', () => {
  assert.equal(translateStatus('gu', 'PAID'), 'ચૂકવેલ');
  assert.equal(translateStatus('hi', 'In_Progress'), 'प्रक्रिया में');
  assert.equal(translateStatus('gu', 'Site survey booked'), 'Site survey booked');
  assert.equal(translateStatus('en', 'PAID'), 'PAID');
  assert.equal(translateStatus('hi', undefined), undefined);
});

test('language choice is remembered, bad or blocked storage falls back to English', () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  assert.equal(loadLanguage(storage), 'en');
  saveLanguage('gu', storage);
  assert.equal(store.get(LANGUAGE_STORAGE_KEY), 'gu');
  assert.equal(loadLanguage(storage), 'gu');
  store.set(LANGUAGE_STORAGE_KEY, 'klingon');
  assert.equal(loadLanguage(storage), 'en');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(loadLanguage(blocked), 'en');
  assert.doesNotThrow(() => saveLanguage('hi', blocked));
  assert.equal(loadLanguage(null), 'en');
});
