const fs = require('fs');

const report = { steps: [], warnings: [], startedAt: Date.now() };

function step(name, msg) {
  const line = `[${name}] ${msg}`;
  console.log(line);
  report.steps.push({ name, msg, at: Date.now() });
}

function warn(msg) {
  console.warn(`  WARN: ${msg}`);
  report.warnings.push(msg);
}

function finish(success, extra = {}) {
  const result = {
    success,
    durationSec: Math.round((Date.now() - report.startedAt) / 1000),
    warnings: report.warnings,
    steps: report.steps.map(s => s.name),
    ...extra,
  };
  return result;
}

function writeReport(path, result) {
  fs.writeFileSync(path, JSON.stringify(result, null, 2));
}

module.exports = { step, warn, finish, writeReport };