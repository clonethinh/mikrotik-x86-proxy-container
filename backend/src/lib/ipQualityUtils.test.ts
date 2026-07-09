import assert from 'node:assert/strict';
import { classifyPublicIp, isBadWanIp, isUsableWanIp } from './ipQualityUtils';

assert.equal(classifyPublicIp(null).quality, 'missing');
assert.equal(classifyPublicIp('100.64.1.2').quality, 'cgnat');
assert.equal(classifyPublicIp('100.127.0.1').quality, 'cgnat');
assert.equal(classifyPublicIp('169.254.1.1').quality, 'link_local');
assert.equal(classifyPublicIp('42.119.198.233').quality, 'public');
assert.equal(classifyPublicIp('42.119.198.233').usable, true);
assert.equal(isBadWanIp('100.64.5.1'), true);
assert.equal(isBadWanIp('203.0.113.1'), false);
assert.equal(isUsableWanIp('203.0.113.1'), true);
assert.equal(isUsableWanIp('100.64.5.1'), false);

console.log('ipQualityUtils.test OK');