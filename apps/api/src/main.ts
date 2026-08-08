import { CleanverseClient } from '@bridgesure/cleanverse';
import { loadConfig } from './config.js';
import { buildServer } from './server.js';

/**
 * API boot entry (see package.json dev/start scripts).
 * The server factory stays importable and injectable for tests.
 */
const config = loadConfig();

const cleanverse = new CleanverseClient({
  apiId: config.CLEANVERSE_API_ID,
  apiKey: config.CLEANVERSE_API_KEY,
  baseUrl: config.CLEANVERSE_BASE_URL,
});

const app = buildServer({ cleanverse });

try {
  await app.listen({ port: config.BRIDGESURE_PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err, 'failed to start BridgeSure API');
  process.exit(1);
}
