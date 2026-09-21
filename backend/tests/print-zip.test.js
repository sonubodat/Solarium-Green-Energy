import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { PDFDocument } from 'pdf-lib';
import { crc32, writeZip } from '../src/services/zip-stream.js';
import { generateQrPrintChunks, PDF_CHUNK_PAGES } from '../src/services/qr-proof.js';
import { streamZipResponse } from '../src/services/stream-zip-response.js';

// Independent ZIP reader (central directory), so the writer is not checked against itself.
function readZip(buffer) {
	const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	assert.ok(eocd >= 0, 'end of central directory record present');
	const count = buffer.readUInt16LE(eocd + 10);
	let offset = buffer.readUInt32LE(eocd + 16);
	const files = [];
	for (let i = 0; i < count; i += 1) {
		assert.equal(buffer.readUInt32LE(offset), 0x02014b50);
		const crc = buffer.readUInt32LE(offset + 16);
		const size = buffer.readUInt32LE(offset + 24);
		const nameLength = buffer.readUInt16LE(offset + 28);
		const localOffset = buffer.readUInt32LE(offset + 42);
		const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
		assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
		const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
		const data = buffer.subarray(dataStart, dataStart + size);
		files.push({ name, data, crc });
		offset += 46 + nameLength;
	}
	return files;
}

const snapshot = { artworkPath: null, pageWidthMm: 210, pageHeightMm: 297, qrX: 60, qrY: 100, qrWidth: 70, qrHeight: 70, labelEnabled: true, labelFontSize: 12, labelTextX: 10, labelTextY: 10 };
const makeJob = (count) => ({ id: 'job1', templateSnapshot: snapshot, items: Array.from({ length: count }, (_, i) => ({ sequence: i + 1, expectedCode: `V-${String(i + 1).padStart(4, '0')}`, expectedUrl: '' })) });

test('crc32 matches the reference implementation', () => {
	const sample = Buffer.from('The quick brown fox jumps over the lazy dog');
	assert.equal(crc32(sample), 0x414fa339);
	if (typeof zlib.crc32 === 'function') assert.equal(crc32(sample), zlib.crc32(sample));
});

test('writeZip output is a valid ZIP with intact entries', async () => {
	const parts = [];
	const files = [{ name: 'a.pdf', buffer: Buffer.from('hello') }, { name: 'sub/é.pdf', buffer: Buffer.alloc(100000, 7) }];
	const result = await writeZip((async function* () { yield* files; })(), async (piece) => { parts.push(Buffer.from(piece)); });
	assert.deepEqual(result, { complete: true, count: 2 });
	const read = readZip(Buffer.concat(parts));
	assert.deepEqual(read.map((f) => f.name), ['a.pdf', 'sub/é.pdf']);
	read.forEach((file, i) => { assert.deepEqual(file.data, files[i].buffer); assert.equal(file.crc, crc32(files[i].buffer)); });
});

test('a stopped stream never writes a central directory', async () => {
	const parts = [];
	let stop = false;
	const result = await writeZip((async function* () { yield { name: 'a', buffer: Buffer.from('x') }; stop = true; yield { name: 'b', buffer: Buffer.from('y') }; })(), async (p) => { parts.push(p); }, () => stop);
	assert.equal(result.complete, false);
	assert.equal(Buffer.concat(parts).includes(Buffer.from([0x50, 0x4b, 0x05, 0x06])), false);
});

test('chunks: 400 items -> 8 PDFs of 50 pages, in order, correct page size, one at a time', async () => {
	assert.equal(PDF_CHUNK_PAGES, 50);
	const seen = [];
	let total = 0;
	for await (const { name, buffer, pages } of generateQrPrintChunks(makeJob(400))) {
		const pdf = await PDFDocument.load(buffer);
		assert.equal(pdf.getPageCount(), pages);
		const { width, height } = pdf.getPage(0).getSize();
		assert.ok(Math.abs(width - 595.28) < 0.5 && Math.abs(height - 841.89) < 0.5, `page size ${width}x${height}`);
		seen.push(name);
		total += pages;
	}
	assert.equal(total, 400);
	assert.equal(seen.length, 8);
	assert.equal(seen[0], 'V-0001_to_V-0050.pdf');
	assert.equal(seen[7], 'V-0351_to_V-0400.pdf');
});

test('chunks: last partial chunk and a lone last item are named correctly', async () => {
	const names = [];
	for await (const chunk of generateQrPrintChunks(makeJob(101))) names.push(chunk.name);
	assert.deepEqual(names, ['V-0001_to_V-0050.pdf', 'V-0051_to_V-0100.pdf', 'V-0101.pdf']);
});

// ---- HTTP behaviour ------------------------------------------------------------------------
function serve(handler) {
	return new Promise((resolve) => {
		const server = http.createServer(handler).listen(0, () => resolve({ server, url: `http://localhost:${server.address().port}` }));
	});
}

test('streamZipResponse: full download is a valid ZIP with the right headers', async () => {
	const { server, url } = await serve(async (request, response) => {
		await streamZipResponse({ response, chunks: generateQrPrintChunks(makeJob(120)), filename: 'x.zip' });
	});
	try {
		const res = await fetch(url);
		assert.equal(res.headers.get('content-type'), 'application/zip');
		assert.match(res.headers.get('content-disposition'), /attachment; filename="x\.zip"/);
		const files = readZip(Buffer.from(await res.arrayBuffer()));
		assert.deepEqual(files.map((f) => f.name), ['V-0001_to_V-0050.pdf', 'V-0051_to_V-0100.pdf', 'V-0101_to_V-0120.pdf']);
		for (const file of files) assert.ok((await PDFDocument.load(file.data)).getPageCount() > 0);
	} finally { server.close(); }
});

test('streamZipResponse: failure before the first chunk rejects with no headers sent', async () => {
	let outcome;
	const { server, url } = await serve(async (request, response) => {
		async function* broken() { throw new Error('artwork missing'); }
		try { await streamZipResponse({ response, chunks: broken(), filename: 'x.zip' }); } catch (error) { outcome = { message: error.message, headersSent: response.headersSent }; }
		response.status = 500; response.statusCode = 500; response.end('{"error":true}');
	});
	try {
		const res = await fetch(url);
		assert.equal(res.status, 500);
		assert.deepEqual(outcome, { message: 'artwork missing', headersSent: false });
	} finally { server.close(); }
});

test('streamZipResponse: failure after the first chunk kills the connection (no truncated "success")', async () => {
	const { server, url } = await serve(async (request, response) => {
		async function* dies() { yield { name: 'a.pdf', buffer: Buffer.from('one') }; throw new Error('boom'); }
		await streamZipResponse({ response, chunks: dies(), filename: 'x.zip' });
	});
	try {
		await assert.rejects(async () => { const res = await fetch(url); await res.arrayBuffer(); });
	} finally { server.close(); }
});

test('streamZipResponse: generation stops when the client disconnects', async () => {
	let produced = 0;
	const { server, url } = await serve(async (request, response) => {
		async function* endless() { for (let i = 0; i < 50; i += 1) { produced += 1; yield { name: `f${i}.pdf`, buffer: Buffer.alloc(1024 * 1024, 1) }; await new Promise((r) => setTimeout(r, 20)); } }
		await streamZipResponse({ response, chunks: endless(), filename: 'x.zip' });
	});
	try {
		const controller = new AbortController();
		const res = await fetch(url, { signal: controller.signal });
		const reader = res.body.getReader();
		await reader.read();
		controller.abort();
		await new Promise((r) => setTimeout(r, 400));
		assert.ok(produced < 20, `stopped early, produced ${produced}`);
	} finally { server.close(); }
});
