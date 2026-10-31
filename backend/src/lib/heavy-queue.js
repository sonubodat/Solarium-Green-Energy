// One PDF job at a time. Render's free tier has 512 MB, and pdf-lib alone peaks near 440 MB at
// 200 pages, so concurrent generations are what actually kills the instance.
//
// - Jobs run strictly one after another (FIFO); a rejected job never blocks the next one.
// - Pass a `key` to share a single run between identical requests that arrive WHILE it is in
//   flight (double clicks). The entry is removed as soon as the run settles, so a finished
//   result is never cached or reused.
// - At most MAX_WAITING jobs may queue behind the running one (running + MAX_WAITING in total);
//   more are refused with 503.
// ponytail: in-process only (one Render instance); multiple instances would need a DB/Redis lock.
const MAX_WAITING = Number(process.env.QR_QUEUE_MAX_WAITING) || 4;

let tail = Promise.resolve();
const inFlight = new Map();
let pending = 0; // running + queued

function busyError() {
	const error = new Error('Another print job is running. Try again in a minute.');
	error.statusCode = 503;
	error.code = 'SERVER_BUSY';
	return error;
}

// maxWaiting: how many may queue behind the running one. Admin batches keep the small default; single-page Solar Mitra
// downloads (a few hundred ms each, small memory) pass a larger number so a burst of vendors waits instead of failing.
export function runHeavy(key, fn, maxWaiting = MAX_WAITING) {
	if (key && inFlight.has(key)) return inFlight.get(key);
	if (pending > maxWaiting) throw busyError();
	pending += 1;
	const run = tail.catch(() => {}).then(fn);
	tail = run;
	run.then(() => { pending -= 1; }, () => { pending -= 1; });
	if (key) {
		inFlight.set(key, run);
		run.finally(() => inFlight.delete(key)).catch(() => {});
	}
	return run;
}

// Test hook: lets tests assert nothing leaks between runs.
export function heavyQueueStats() {
	return { pending, inFlight: inFlight.size };
}
