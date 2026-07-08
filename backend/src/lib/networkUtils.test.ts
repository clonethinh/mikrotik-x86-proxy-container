/**
 * Lightweight assertions — run: npx ts-node src/lib/networkUtils.test.ts
 */
import {
  computePorts,
  maxPppoeIdx,
  vethIpsForIdx,
} from './networkUtils';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// idx 1..255 stay on 172.18.x
const p2 = computePorts(2);
assert(p2.containerIp === '172.18.2.2', `idx2 ip: ${p2.containerIp}`);
assert(p2.extHttpPort === 30057, `idx2 http: ${p2.extHttpPort}`);
assert(p2.extSocksPort === 31057, `idx2 socks: ${p2.extSocksPort}`);

const p255 = vethIpsForIdx(255);
assert(p255.containerIp === '172.18.255.2', `idx255 ip: ${p255.containerIp}`);

// idx 256 rolls to 172.19.1
const p256 = vethIpsForIdx(256);
assert(p256.containerIp === '172.19.1.2', `idx256 ip: ${p256.containerIp}`);

const p300 = computePorts(300);
assert(p300.extHttpPort === 30355, `idx300 http: ${p300.extHttpPort}`);
assert(p300.extSocksPort === 31355, `idx300 socks: ${p300.extSocksPort}`);

assert(maxPppoeIdx() >= 3000, `max idx too low: ${maxPppoeIdx()}`);

console.log(`networkUtils OK — maxPppoeIdx=${maxPppoeIdx()}`);