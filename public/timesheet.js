/* Reads the Driver Recap workbook in the browser. Only three things are kept:
   driver name, date and "Total Hours". Pay figures in the file are never
   read into the app or sent anywhere. No outside library is used. */
(function (root) {
  const u16 = (b, o) => b[o] | (b[o + 1] << 8), u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function unzip(buf, wanted) {
    const b = new Uint8Array(buf); let e = b.length - 22;
    while (e >= 0 && u32(b, e) !== 0x06054b50) e--;
    if (e < 0) throw new Error('This is not an Excel .xlsx file.');
    const out = {}; let p = u32(b, e + 16); const n = u16(b, e + 10), td = new TextDecoder();
    for (let i = 0; i < n; i++) {
      if (u32(b, p) !== 0x02014b50) break;
      const method = u16(b, p + 10), csize = u32(b, p + 20), nl = u16(b, p + 28), xl = u16(b, p + 30), cl = u16(b, p + 32), lo = u32(b, p + 42);
      const name = td.decode(b.subarray(p + 46, p + 46 + nl));
      if (wanted(name)) {
        const ds = lo + 30 + u16(b, lo + 26) + u16(b, lo + 28), raw = b.subarray(ds, ds + csize);
        out[name] = td.decode(method === 0 ? raw : await inflate(raw));
      }
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  const colNum = ref => { let n = 0; for (const ch of ref) { if (ch < 'A' || ch > 'Z') break; n = n * 26 + ch.charCodeAt(0) - 64; } return n; };
  const serialDate = v => new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);

  /* -> [{ name, days: { 'YYYY-MM-DD': hours } }] */
  async function readRecap(file) {
    const files = await unzip(await file.arrayBuffer(), n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    const sheetName = Object.keys(files).filter(n => n.includes('worksheets')).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
    if (!sheetName) throw new Error('No worksheet was found in this file.');
    const xml = s => new DOMParser().parseFromString(s, 'application/xml');
    const strings = files['xl/sharedStrings.xml'] ? [...xml(files['xl/sharedStrings.xml']).getElementsByTagName('si')].map(si => [...si.getElementsByTagName('t')].map(t => t.textContent).join('')) : [];
    const rows = [];
    for (const r of xml(files[sheetName]).getElementsByTagName('row')) {
      const cells = {};
      for (const c of r.getElementsByTagName('c')) {
        const v = c.getElementsByTagName('v')[0], t = c.getAttribute('t'), col = colNum(c.getAttribute('r') || '');
        if (t === 'inlineStr') { cells[col] = [...c.getElementsByTagName('t')].map(x => x.textContent).join(''); continue; }
        if (!v) continue;
        cells[col] = t === 's' ? strings[+v.textContent] : t === 'str' ? v.textContent : Number(v.textContent);
      }
      rows.push(cells);
    }
    const out = [];
    for (let i = 0; i + 1 < rows.length; i++) {
      const label = rows[i + 1][1], name = rows[i][1];
      if (typeof label !== 'string' || label.trim().toLowerCase() !== 'total hours' || typeof name !== 'string' || !name.trim() || /^spare$/i.test(name.trim())) continue;   // SPARE blocks are empty placeholders
      const days = {};
      for (const col of Object.keys(rows[i])) {
        const d = rows[i][col], h = rows[i + 1][col];
        if (+col > 1 && typeof d === 'number' && d > 30000 && d < 80000 && typeof h === 'number') days[serialDate(d)] = Math.round(h * 100) / 100;
      }
      if (Object.keys(days).length) out.push({ name: name.trim(), days });
    }
    if (!out.length) throw new Error('No "Total Hours" rows were found. This needs the Driver Recap sheet layout: a driver name row with dates, then a Total Hours row.');
    return out;
  }
  const nameKey = n => String(n || '').toLowerCase().replace(/[^a-z\s,]/g, '').split(/[\s,]+/).filter(Boolean).sort().join(' ');
  root.Timesheet = { readRecap, nameKey };
})(self);
