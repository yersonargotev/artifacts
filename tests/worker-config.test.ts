import assert from 'node:assert/strict';
import { test } from 'node:test';
import { panelWranglerConfig, services, workerOutputConfig } from '../scripts/build-workers.ts';

test('every Worker deploys with Workers Observability sampling every invocation', () => {
  assert.deepEqual(Object.keys(services), ['auth', 'mcp', 'panel', 'view']);
  for (const name of ['auth', 'mcp', 'panel', 'view'] as const) {
    const { worker } = services[name];
    assert.deepEqual(workerOutputConfig(name, worker).observability, { enabled: true, headSamplingRate: 1 }, `${worker.name} worker.config.json enables observability for every invocation`);
  }
  assert.deepEqual(panelWranglerConfig(services.panel.worker, 'worker.ts').observability, { enabled: true, head_sampling_rate: 1 }, 'the panel wrangler.json enables observability for every invocation');
});
