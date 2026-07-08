/**
 * Run: npx ts-node src/lib/metricsBucketUtils.test.ts
 */
import {
  hourBucket,
  dayBucket,
  weekBucket,
  monthBucket,
  parentBucket,
  integrateSamples,
} from './metricsBucketUtils';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const ts = new Date('2026-07-07T14:35:22.000Z');
assert(hourBucket(ts) === '2026-07-07T14:00:00.000Z', `hour: ${hourBucket(ts)}`);
assert(dayBucket(ts) === '2026-07-07', `day: ${dayBucket(ts)}`);
assert(weekBucket(ts) === '2026-07-06', `week Mon: ${weekBucket(ts)}`);
assert(monthBucket(ts) === '2026-07-01', `month: ${monthBucket(ts)}`);

assert(parentBucket('hour', '2026-07-07T14:00:00.000Z') === '2026-07-07', 'hour→day');
assert(parentBucket('day', '2026-07-07') === '2026-07-06', 'day→week');

const samples = [
  { ts: new Date('2026-07-07T14:00:00.000Z'), rxBps: 1000, txBps: 500 },
  { ts: new Date('2026-07-07T14:00:10.000Z'), rxBps: 2000, txBps: 1000 },
];
const integrated = integrateSamples(samples);
assert(integrated.rxBytes === 10000n, `rx integrated: ${integrated.rxBytes}`);
assert(integrated.txBytes === 5000n, `tx integrated: ${integrated.txBytes}`);
assert(integrated.byHour.get('2026-07-07T14:00:00.000Z')?.rx === 10000n, 'byHour rx');

console.log('metricsBucketUtils OK');