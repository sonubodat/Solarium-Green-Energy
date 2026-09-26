// Run: node --test frontend/tests/auto-poster.test.mjs   (no browser, no backend)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const copy = path.join(os.tmpdir(), `auto-poster-under-test-${process.pid}.mjs`);
fs.copyFileSync(path.join(here, '../src/lib/auto-poster.js'), copy); // .js is CommonJS here; .mjs loads as ESM
const { POSTER_TEMPLATE_STORAGE_KEY, pickDefaultTemplate, splitIntoPosterBatches } = await import(pathToFileURL(copy));

const tpl = (id, status) => ({ id, status, name: id });

test('default template: the one this browser used last, if it is still published', () => {
  const templates = [tpl('new', 'PUBLISHED'), tpl('mine', 'PUBLISHED'), tpl('old', 'PUBLISHED')];
  assert.equal(pickDefaultTemplate(templates, 'mine'), 'mine');
});

test('default template: otherwise the newest published one (the list is newest first)', () => {
  const templates = [tpl('draft', 'DRAFT'), tpl('newest', 'PUBLISHED'), tpl('older', 'PUBLISHED')];
  assert.equal(pickDefaultTemplate(templates, ''), 'newest');
  assert.equal(pickDefaultTemplate(templates, 'not-there'), 'newest');
});

test('default template: a remembered template that is now draft/archived is not selected', () => {
  const templates = [tpl('a', 'PUBLISHED'), tpl('remembered', 'ARCHIVED')];
  assert.equal(pickDefaultTemplate(templates, 'remembered'), 'a');
});

test('default template: nothing published means nothing selected', () => {
  assert.equal(pickDefaultTemplate([tpl('d', 'DRAFT'), tpl('x', 'ARCHIVED')], 'd'), '');
  assert.equal(pickDefaultTemplate([], ''), '');
});

test('storage key is namespaced', () => {
  assert.equal(POSTER_TEMPLATE_STORAGE_KEY, 'solarium:auto-poster-template');
});

test('splitIntoPosterBatches: batches of at most the server cap, in order, none lost', () => {
  const codes = Array.from({ length: 1201 }, (_, i) => `V-${1148 + i}`);
  const batches = splitIntoPosterBatches(codes, 500);
  assert.deepEqual(batches.map((b) => b.codes.length), [500, 500, 201]);
  assert.deepEqual(batches.map((b) => [b.index, b.first, b.last]), [[0, 'V-1148', 'V-1647'], [1, 'V-1648', 'V-2147'], [2, 'V-2148', 'V-2348']]);
  assert.deepEqual(batches.flatMap((b) => b.codes), codes);
  assert.deepEqual(splitIntoPosterBatches([], 500), []);
});
