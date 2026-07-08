/** Parse /interface ethernet print → danh sách etherN */
function parseEthernetPorts(printOut) {
  const ports = [];
  for (const line of printOut.split('\n')) {
    const m = line.match(/^\s*\d+\s+\w*\s*name="?(ether\d+)"?/i)
      || line.match(/name="?(ether\d+)"?/i);
    if (m && !ports.includes(m[1])) ports.push(m[1]);
  }
  if (!ports.length) {
    for (const line of printOut.split('\n')) {
      const m = line.match(/name="?(ether\d+)"?/i);
      if (m && !ports.includes(m[1])) ports.push(m[1]);
    }
  }
  return ports.sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''), 10) || 0;
    const nb = parseInt(b.replace(/\D/g, ''), 10) || 0;
    return na - nb;
  });
}

function parsePortList(input, available) {
  const raw = (input || '').split(/[,\s;]+/).map(s => s.trim()).filter(Boolean);
  if (!raw.length) return [];
  const out = [];
  for (const p of raw) {
    let name = p;
    if (/^\d+$/.test(p)) name = `ether${p}`;
    const m = name.match(/^ether(\d+)$/i);
    if (!m) continue;
    const finalName = `ether${m[1]}`;
    const match = available.find(a => a.toLowerCase() === finalName.toLowerCase()) || finalName;
    if (!out.includes(match)) out.push(match);
  }
  return out;
}

module.exports = { parseEthernetPorts, parsePortList };