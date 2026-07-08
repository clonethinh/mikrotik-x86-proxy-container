/**
 * Run: npx ts-node src/lib/proxyLogParser.test.ts
 */
import {
  parseProxyLogLine,
  normalizeLogLine,
  dedupeKey,
  shouldIngestLog,
} from './proxyLogParser';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const sample = '1780427602.181 00000 u4899 100.102.86.60 56273 httpbin.org 80 100 262 PROXY 1739';
const p = parseProxyLogLine(sample);
assert(p !== null, 'parse sample');
assert(p!.username === 'u4899', `user: ${p!.username}`);
assert(p!.destHost === 'httpbin.org', `host: ${p!.destHost}`);
assert(p!.destPort === 80, `port: ${p!.destPort}`);
assert(p!.txBytes === 100n, `tx: ${p!.txBytes}`);
assert(p!.rxBytes === 262n, `rx: ${p!.rxBytes}`);
assert(p!.durationMs === 1739, `dur: ${p!.durationMs}`);
assert(p!.errorCode === 0, `err: ${p!.errorCode}`);

const prefixed = `- +_L${sample}`;
const p2 = parseProxyLogLine(prefixed);
assert(p2 !== null && p2.username === 'u4899', 'parse prefixed line');

const https = '1780427602.680 00000 u4899 100.102.86.60 56277 api.ipify.org 443 810 3578 PROXY 468';
const p3 = parseProxyLogLine(https);
assert(p3!.destPort === 443 && p3!.txBytes === 810n, 'https line');

assert(parseProxyLogLine('garbage') === null, 'reject garbage');
assert(shouldIngestLog('_webui_mon') === false, 'skip monitor');
assert(shouldIngestLog('u4899') === true, 'allow proxy user');

const key = dedupeKey(p!, 42);
assert(key.includes('42:') && key.includes('httpbin.org'), `dedupe key: ${key}`);

const norm = normalizeLogLine(`  noise - +_L${sample}  `);
assert(norm.startsWith('1780427602'), `normalized: ${norm}`);

console.log('proxyLogParser OK');