import { randomBytes } from 'node:crypto';
import { createTargetApp } from './app.js';

// Starts MERIDIAN Core for local use. Integration tests create the app in process.

const username = process.env.TARGET_USERNAME;
const password = process.env.TARGET_PASSWORD;
if (username === undefined || username === '' || password === undefined || password === '') {
  console.error('Invalid environment. TARGET_USERNAME and TARGET_PASSWORD are required. Copy .env.example to .env.');
  process.exit(1);
}

const baseUrl = new URL(process.env.TARGET_BASE_URL ?? 'http://localhost:4010');
const port = Number(baseUrl.port === '' ? '80' : baseUrl.port);

const app = createTargetApp({
  username,
  password,
  testMode: process.env.TARGET_TEST_MODE === '1',
  // A fresh seed per process unless one is pinned, so generated ids change across restarts.
  idSeed: process.env.TARGET_ID_SEED ?? randomBytes(8).toString('hex'),
});

app.listen(port, '127.0.0.1', (error?: Error) => {
  if (error !== undefined) {
    console.error(`MERIDIAN Core could not listen on port ${port}. ${error.message}`);
    process.exit(1);
  }
  console.log(`MERIDIAN Core listening on http://localhost:${port}`);
});
