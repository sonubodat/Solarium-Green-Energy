import { writeZip } from './zip-stream.js';

// Streams `chunks` (an async iterator of { name, buffer }) to an HTTP response as a ZIP.
// - The FIRST chunk is produced before any header is sent, so a failure there (bad artwork, storage
//   down) rejects normally and the caller can answer with a JSON error.
// - After headers are sent, a failure destroys the connection: the browser reports a failed download
//   instead of saving a truncated ZIP that looks complete.
// - If the client goes away, generation stops after the current chunk.
// - Returns true only when the whole ZIP was written and the response ended cleanly.
export async function streamZipResponse({ response, chunks, filename }) {
	const first = await chunks.next();
	let clientGone = false;
	// response 'close' without a finished response = the connection dropped (request 'close' would
	// also fire for a normally received GET, so it cannot be used here).
	response.on('close', () => { if (!response.writableFinished) clientGone = true; });

	response.setHeader('Content-Type', 'application/zip');
	response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
	response.flushHeaders();

	async function* entries() {
		if (!first.done) yield first.value;
		yield* chunks;
	}
	const write = (piece) => new Promise((resolve) => {
		if (response.write(piece)) return resolve();
		response.once('drain', resolve);
		return response.once('close', resolve);
	});

	try {
		const result = await writeZip(entries(), write, () => clientGone || response.destroyed);
		if (!result.complete) {
			response.destroy();
			return false;
		}
		response.end();
		return true;
	} catch (error) {
		console.error('[QrPdf] zip stream failed:', error);
		response.destroy(error);
		return false;
	}
}
