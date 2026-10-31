import sharp from 'sharp';
import { app } from './app.js';
import { env } from './config/env.js';

// Small-instance memory discipline (512 MB): sharp works on one image at a time with a small cache, so a burst of
// photo uploads or print jobs cannot multiply native memory use.
sharp.concurrency(1);
sharp.cache({ memory: 50, items: 20, files: 0 });

app.listen(env.port, () => {
  console.log(`Solarium API listening on port ${env.port}`);
});

// One line a minute with the process memory in MB, so a leak or a spike is visible in the host's logs. It never
// logs request data. unref() so the timer alone never keeps the process alive.
const MB = 1024 * 1024;
setInterval(() => {
  const { rss, heapUsed, external } = process.memoryUsage();
  console.log(`[Memory] rss=${Math.round(rss / MB)}MB heap=${Math.round(heapUsed / MB)}MB external=${Math.round(external / MB)}MB`);
}, 60 * 1000).unref();
