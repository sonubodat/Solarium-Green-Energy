import test from 'node:test';
import assert from 'node:assert/strict';
import { runHeavy, heavyQueueStats } from '../src/lib/heavy-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('a failed job does not block the next job', async () => {
	const failing = runHeavy(null, async () => { throw new Error('boom'); });
	const next = runHeavy(null, async () => 'ok');
	await assert.rejects(failing, /boom/);
	assert.equal(await next, 'ok');
});

test('same key in flight runs once and shares the result', async () => {
	let runs = 0;
	const work = async () => { runs += 1; await sleep(20); return 'r'; };
	const results = await Promise.all([runHeavy('k', work), runHeavy('k', work), runHeavy('k', work)]);
	assert.deepEqual(results, ['r', 'r', 'r']);
	assert.equal(runs, 1);
});

test('a completed key is not reused', async () => {
	let runs = 0;
	const work = async () => { runs += 1; return runs; };
	assert.equal(await runHeavy('again', work), 1);
	await sleep(0);
	assert.equal(await runHeavy('again', work), 2);
});

test('jobs without a key run one at a time in order', async () => {
	let active = 0;
	let peak = 0;
	const order = [];
	const job = (id) => async () => {
		active += 1; peak = Math.max(peak, active);
		await sleep(10);
		order.push(id); active -= 1;
	};
	await Promise.all([1, 2, 3].map((id) => runHeavy(null, job(id))));
	assert.equal(peak, 1);
	assert.deepEqual(order, [1, 2, 3]);
});

test('overflow is refused with SERVER_BUSY and frees up afterwards', async () => {
	const gate = new Promise((resolve) => setTimeout(resolve, 40));
	const accepted = Array.from({ length: 5 }, () => runHeavy(null, () => gate));
	assert.throws(() => runHeavy(null, async () => 'x'), (error) => error.code === 'SERVER_BUSY' && error.statusCode === 503);
	await Promise.all(accepted);
	assert.equal(await runHeavy(null, async () => 'free'), 'free');
});

test('nothing leaks after success or failure', async () => {
	await runHeavy('leak-ok', async () => 1);
	await assert.rejects(runHeavy('leak-bad', async () => { throw new Error('x'); }));
	await sleep(0);
	assert.deepEqual(heavyQueueStats(), { pending: 0, inFlight: 0 });
});
