import { CleanverseClient } from '@bridgesure/cleanverse';
import { loadConfig } from './config.js';
import { DemoCleanverseClient } from './demo-cleanverse.js';
import { buildServer } from './server.js';

/**
 * API boot entry (see package.json dev/start scripts).
 * The server factory stays importable and injectable for tests.
 *
 * Default mode is `demo`: a scripted sandbox mock that needs no network, no
 * credentials, and no funded wallet (see packages/cleanverse mocks). Set
 * BRIDGESURE_CLEANVERSE_MODE=live to use the real Cleanverse transport with
 * the API id/key from the environment.
 */
const config = loadConfig();

const cleanverse =
  config.BRIDGESURE_CLEANVERSE_MODE === 'live'
    ? new CleanverseClient({
        apiId: config.CLEANVERSE_API_ID,
        apiKey: config.CLEANVERSE_API_KEY,
        baseUrl: config.CLEANVERSE_BASE_URL,
      })
    : new DemoCleanverseClient(
        config.BRIDGESURE_IMPORTER_ADDRESS,
        config.BRIDGESURE_EXPORTER_ADDRESS,
      );

const app = buildServer({ cleanverse });

try {
  await app.listen({ port: config.BRIDGESURE_PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err, 'failed to start BridgeSure API');
  process.exit(1);
}
