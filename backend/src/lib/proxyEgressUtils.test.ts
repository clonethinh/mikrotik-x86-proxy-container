/**
 * Lightweight assertions — run: npx ts-node src/lib/proxyEgressUtils.test.ts
 */
import { egressIdx, resolveProxyEgress } from './proxyEgressUtils';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  resolveProxyEgress({ pppoeIdx: 12, pppoeName: 'pppoe-out12', egressPppoeName: 'pppoe-out71' }) === 'pppoe-out71',
  'egress pool name',
);
assert(
  resolveProxyEgress({ pppoeIdx: 5, pppoeName: 'pppoe-out5', egressPppoeName: null }) === 'pppoe-out5',
  'fallback pppoeName',
);
assert(
  resolveProxyEgress({ pppoeIdx: 3, pppoeName: '', egressPppoeName: null }) === 'pppoe-out3',
  'fallback pppoe-outN',
);
assert(egressIdx('pppoe-out71') === 71, 'egressIdx parse');

console.log('proxyEgressUtils.test.ts OK');