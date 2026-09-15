import { createControlTokens } from '../../src/control/controlToken.js';
import { createTestClock } from '../../src/runtime/clock.js';
import { createSequentialIds } from '../../src/runtime/ids.js';
import { createFakeSurfaceDriver } from '../../src/surface/fake/fakeSurfaceDriver.js';
import { meridianScript } from '../fixtures/surface/meridianScreens.js';
import { surfaceDriverContract } from './surfaceDriver.contract.js';

surfaceDriverContract('fake', async () => {
  const tokens = createControlTokens('sess_contract', createSequentialIds());
  return {
    driver: createFakeSurfaceDriver({
      sessionId: 'sess_contract',
      control: tokens,
      script: meridianScript({ searchLeadsTo: 'noRecords' }),
      clock: createTestClock('2026-09-15T09:00:00.000Z'),
    }),
    tokens,
    close: async () => undefined,
  };
});
