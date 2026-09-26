import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DAY_MS = 24 * 60 * 60 * 1000;
process.env.SESSION_LIFETIME_DAYS = ''; // hermetic: the default (7) applies whatever .env.local holds
const { SESSION_LIFETIME_MS, setSessionCookie, sessionCookieName } = await import('../src/services/auth.js');

test('a login now lasts 7 days by default (was 24 hours)', () => {
	assert.equal(SESSION_LIFETIME_MS, 7 * DAY_MS);
});

test('the cookie Max-Age matches the server-side expiry for Admin, Sales and Solar Mitra', () => {
	for (const role of ['ADMIN', 'SALES', 'VENDOR']) {
		let cookies;
		setSessionCookie({ setHeader: (_name, value) => { cookies = value; } }, 'token', role);
		const session = cookies.find((cookie) => cookie.startsWith(`${sessionCookieName(role)}=`));
		assert.match(session, /Max-Age=604800;/, role);
		assert.match(session, /HttpOnly/, role);
	}
});

test('SESSION_LIFETIME_DAYS is clamped to 1-30 days, garbage falls back to 7', () => {
	const envModule = fileURLToPath(new URL('../src/config/env.js', import.meta.url));
	const days = (value) => Number(execFileSync(process.execPath, ['--input-type=module', '-e', `import { env } from ${JSON.stringify(envModule)}; console.log(env.sessionLifetimeDays);`], {
		env: { ...process.env, SESSION_LIFETIME_DAYS: value },
	}).toString().trim().split('\n').pop());
	assert.equal(days('10'), 10);
	assert.equal(days('500'), 30);
	assert.equal(days('-3'), 1);
	assert.equal(days('abc'), 7);
	assert.equal(days('0'), 7);
});
