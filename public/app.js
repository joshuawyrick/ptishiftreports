/* PTI Shift Reports: page logic. Loads the report once per period, then
   filters, sorts, charts and exports it in the browser. */
(function () {
  const C = Core, $ = id => document.getElementById(id);
  const D = C.fmtDurWords, mi = m => C.miles(m).toFixed(1);
  const st = { report: null, view: 'overview', sort: {}, q: '', loading: false, status: null, direct: true, a: '', b: '', hos: null, hosErr: '', hosLoading: false, eld: null, eldErr: '', eldLoading: false, reviewOnly: false, ts: null, tsMsg: '', tol: 30, diffOnly: false, faults: null, faultsErr: '', faultsLoading: false, activeOnly: false };
  const TITLES = { overview: 'Overview', shifts: 'Shifts', stops: 'Stops', daily: 'Hours by day', totals: 'Driver totals', sites: 'Time on site', lanes: 'Point to point', compare: 'Compare two locations', faults: 'Fault history', hos: '80-hour clock', eld: 'Shift hours (ELD)', eldday: 'Hours by driver and day', tscheck: 'Compare to timesheets', check: 'Connection check', rules: 'How numbers are worked out' };

  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    for (const c of [].concat(kids || [])) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
  }

  /* ---------- icons, stat cards, charts ---------- */
  const ICONS = {
    home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2', truck: 'M2 7h11v9H2zM13 10h4l4 3v3h-8zM6 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
    pin: 'M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z', cal: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4', person: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
    clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2', target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8z', swap: 'M4 8h14l-3-3M20 16H6l3 3', road: 'M8 3L4 21M16 3l4 18M12 5v3M12 11v3M12 17v3',
    shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', wrench: 'M14 6a4 4 0 005 5l-9 9a2 2 0 01-3-3l9-9a4 4 0 00-2-2z', alert: 'M12 4l9 16H3zM12 10v4M12 17v.5', check: 'M12 21a9 9 0 100-18 9 9 0 000 18zM8 12l3 3 5-6',
    sheet: 'M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3', list: 'M5 6h14M5 12h14M5 18h14'
  };
  const NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, kids) { const e = document.createElementNS(NS, tag); for (const k in attrs || {}) e.setAttribute(k, attrs[k]); for (const c of [].concat(kids || [])) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); return e; }
  function icon(name) { return svg('svg', { class: 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true' }, [svg('path', { d: ICONS[name] || ICONS.list })]); }
  const NAV_ICONS = { overview: 'home', eld: 'clock', eldday: 'cal', tscheck: 'sheet', shifts: 'truck', stops: 'pin', daily: 'cal', totals: 'person', sites: 'clock', lanes: 'target', compare: 'swap', hos: 'shield', faults: 'alert', check: 'check', rules: 'list' };
  function tileIcon(label) {
    const l = label.toLowerCase();
    return /limit|review|over|fault|lamp|missing|higher/.test(l) ? 'alert' : /driver/.test(l) ? 'person' : /truck/.test(l) ? 'truck' : /mile/.test(l) ? 'road' : /stop|site/.test(l) && !/time/.test(l) ? 'pin' : /hour|time|average|reset|clock/.test(l) ? 'clock' : /match/.test(l) ? 'check' : /shift|day|episode/.test(l) ? 'cal' : 'chart';
  }
  function tile(v, label, alert) { return el('div', { class: alert ? 'alert' : '' }, [el('span', { class: 'kic' }, [icon(tileIcon(label))]), el('span', { class: 'kt' }, [el('b', { text: String(v) }), el('span', { text: label })])]); }
  function chartPanel(title, ic, body, hint) { return el('section', { class: 'panel' }, [el('header', {}, [el('h2', {}, [icon(ic), title]), hint ? el('span', { class: 'hint', text: hint }) : null]), el('div', { class: 'body' }, [body])]); }
  function hbars(items, blue) {
    const max = Math.max(1, ...items.map(i => i.value)), box = el('div', { class: 'rank' + (blue ? ' blue' : '') });
    if (!items.length) return el('div', { class: 'hint', text: 'Nothing to chart for this period.' });
    items.forEach(i => { box.appendChild(el('span', { class: 'name', text: i.label, title: i.label })); box.appendChild(el('span', { class: 'track' }, [el('i', { style: 'width:' + (i.value / max * 100) + '%' })])); box.appendChild(el('span', { class: 'num', text: i.text })); });
    return box;
  }
  function donut(parts, centre) {
    const total = parts.reduce((a, p) => a + p.value, 0) || 1, R = 54, CIRC = 2 * Math.PI * R; let off = 0;
    const g = svg('svg', { viewBox: '0 0 150 150', role: 'img', 'aria-label': parts.map(p => p.label + ' ' + Math.round(p.value / total * 100) + ' percent').join(', ') }, [svg('circle', { cx: 75, cy: 75, r: R, fill: 'none', stroke: '#1a2f57', 'stroke-width': 20 })]);
    parts.forEach(p => { const len = p.value / total * CIRC; g.appendChild(svg('circle', { cx: 75, cy: 75, r: R, fill: 'none', stroke: p.color, 'stroke-width': 20, 'stroke-dasharray': len + ' ' + (CIRC - len), 'stroke-dashoffset': -off, transform: 'rotate(-90 75 75)' })); off += len; });
    g.appendChild(svg('text', { x: 75, y: 70, 'text-anchor': 'middle', class: 'c1' }, ['Total'])); g.appendChild(svg('text', { x: 75, y: 90, 'text-anchor': 'middle', class: 'c2' }, [centre]));
    return el('div', { class: 'donut' }, [g, el('ul', {}, parts.map(p => el('li', {}, [el('i', { style: 'background:' + p.color }), el('span', { text: p.label }), el('small', { text: p.text + ' (' + Math.round(p.value / total * 100) + '%)' })])))]);
  }
  function lineChart(points, unit) {
    if (points.length < 2) return el('div', { class: 'hint', text: 'Pick a period of two or more days to see a trend.' });
    const W = 520, Hh = 170, L = 34, B = 22, T = 10, max = Math.max(1, ...points.map(p => p.y)), top = Math.ceil(max / 4) * 4 || 4;
    const x = i => L + i * (W - L - 8) / (points.length - 1), y = v => T + (1 - v / top) * (Hh - T - B);
    const g = svg('svg', { viewBox: '0 0 ' + W + ' ' + Hh, preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Trend by day, highest ' + max.toFixed(0) + ' ' + unit });
    for (let i = 0; i <= 4; i++) { const v = top * i / 4; g.appendChild(svg('line', { x1: L, x2: W - 8, y1: y(v), y2: y(v), stroke: '#1d3a6b', 'stroke-width': 1 })); g.appendChild(svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, [String(Math.round(v))])); }
    const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.y).toFixed(1)).join(' ');
    g.appendChild(svg('path', { d: d + ' L' + x(points.length - 1) + ' ' + y(0) + ' L' + x(0) + ' ' + y(0) + ' Z', fill: 'rgba(224,35,46,.22)' })); g.appendChild(svg('path', { d, fill: 'none', stroke: '#ff5a5f', 'stroke-width': 2.2 }));
    const every = Math.ceil(points.length / 9);
    points.forEach((p, i) => { const c = svg('circle', { cx: x(i), cy: y(p.y), r: 3.2, fill: '#ff5a5f' }, [svg('title', {}, [p.label + ': ' + p.y.toFixed(1) + ' ' + unit])]); g.appendChild(c); if (i % every === 0) g.appendChild(svg('text', { x: x(i), y: Hh - 6, 'text-anchor': 'middle' }, [p.label])); });
    return el('div', { class: 'line' }, [g]);
  }
  const md = d => Number(d.slice(5, 7)) + '/' + Number(d.slice(8));
  function byDay(list, dateOf, valOf, start, end) { const m = {}; for (const r of list) m[dateOf(r)] = (m[dateOf(r)] || 0) + valOf(r); const out = []; for (let d = start; d <= end; d = C.addDays(d, 1)) out.push({ label: md(d), y: m[d] || 0 }); return out; }
  function top5(list, keyOf, valOf, fmt) { const m = new Map(); for (const r of list) m.set(keyOf(r), (m.get(keyOf(r)) || 0) + valOf(r)); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value, text: fmt(value) })); }
  const hh = ms => (ms / C.H).toFixed(1) + ' h';

  /* charts shown under each report */
  function chartsFor(view) {
    const r = st.report, grid = kids => el('div', { class: 'grid3' }, kids);
    if (['shifts', 'stops', 'daily', 'totals', 'sites', 'lanes'].includes(view)) {
      if (!r) return null; const S = shifts(); if (!S.length) return null;
      const legs = [].concat(...S.map(s => s.legs.filter(l => !l.isReturn && !l.yardVisit).map(l => ({ s, l }))));
      const drive = S.reduce((a, s) => a + s.drive, 0), site = S.reduce((a, s) => a + s.onSite, 0), dur = S.reduce((a, s) => a + s.dur, 0), other = Math.max(0, dur - drive - site);
      const time = chartPanel('Time breakdown', 'clock', donut([{ label: 'Drive time', value: drive, color: '#2f8bff', text: D(drive) }, { label: 'On site', value: site, color: '#e0232e', text: D(site) }, { label: 'Unsaved stops and yard', value: other, color: '#7f93b3', text: D(other) }], Math.round(dur / C.H) + ' h'));
      if (view === 'stops' || view === 'sites') return grid([chartPanel('Stops by location', 'chart', hbars(top5(legs, x => C.label(x.l.place), () => 1, v => String(v))), 'Top 5'), time,
        chartPanel('Stops per day', 'cal', lineChart(byDay(legs, x => x.s.date, () => 1, r.start, r.end), 'stops'))]);
      if (view === 'lanes') return grid([chartPanel('Busiest lanes', 'target', hbars(laneRows().slice(0, 5).map(l => ({ label: l.from + ' to ' + l.to, value: l.n, text: String(l.n) }))), 'Top 5 by trips'), time,
        chartPanel('Miles per day', 'road', lineChart(byDay(S, s => s.date, s => C.miles(s.meters), r.start, r.end), 'miles'))]);
      if (view === 'totals') return grid([chartPanel('Hours by driver', 'person', hbars(top5(S, s => s.driver, s => s.dur, hh)), 'Top 5'), time, chartPanel('Miles by driver', 'road', hbars(top5(S, s => s.driver, s => C.miles(s.meters), v => Math.round(v).toLocaleString()), true), 'Top 5')]);
      return grid([chartPanel(view === 'daily' ? 'Hours by driver' : 'Shifts by start yard', 'chart', hbars(view === 'daily' ? top5(S, s => s.driver, s => s.dur, hh) : top5(S, s => s.startYard, () => 1, v => String(v))), 'Top 5'), time,
        chartPanel('Hours worked per day', 'cal', lineChart(byDay(S, s => s.date, s => s.dur / C.H, r.start, r.end), 'hours'))]);
    }
    if (view === 'eld' || view === 'eldday') {
      if (!st.eld || st.eld.example) return null; const R = eldRows(); if (!R.length) return null;
      const drive = R.reduce((a, x) => a + x.drive, 0), duty = R.reduce((a, x) => a + x.onDuty - x.drive, 0), brk = R.reduce((a, x) => a + x.breakTime, 0), span = R.reduce((a, x) => a + x.span, 0);
      const flags = new Map(); for (const x of R) for (const f of x.flags.filter(f => REVIEW.test(f))) { const k = f.replace(/^Off [\d.]+h/, 'Off 4h or more'); flags.set(k, (flags.get(k) || 0) + 1); }
      return grid([chartPanel(view === 'eld' ? 'Shifts to review, by reason' : 'Shift hours by driver', view === 'eld' ? 'alert' : 'person', hbars(view === 'eld' ? [...flags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([label, value]) => ({ label, value, text: String(value) })) : top5(R, x => x.driver, x => x.span, hh)), 'Top 5'),
        chartPanel('Time breakdown', 'clock', donut([{ label: 'Driving', value: drive, color: '#2f8bff', text: D(drive) }, { label: 'On duty, not driving', value: duty, color: '#e0232e', text: D(duty) }, { label: 'Off-duty breaks', value: brk, color: '#7f93b3', text: D(brk) }], Math.round(span / C.H) + ' h')),
        chartPanel('Shift hours per day', 'cal', lineChart(byDay(R, x => x.date, x => x.span / C.H, st.eld.start, st.eld.end), 'hours'))]);
    }
    return null;
  }
  function reportBand() {
    const S = shifts(), legs = [].concat(...S.map(s => s.legs.filter(l => !l.isReturn && !l.yardVisit))), sum = f => S.reduce((a, s) => a + f(s), 0), site = legs.reduce((a, l) => a + l.onSite, 0);
    return el('section', { class: 'band', 'aria-label': 'Totals for the period' }, [tile(legs.length.toLocaleString(), 'Total stops'), tile(new Set([].concat(...S.map(s => s.vehicle.split(' / ')))).size, 'Unique trucks'), tile(new Set(S.map(s => s.driverId)).size, 'Unique drivers'),
      tile(legs.length ? D(site / legs.length) : '0m', 'Avg. time on site'), tile(D(sum(s => s.drive)), 'Total drive time'), tile(Math.round(C.miles(sum(s => s.meters))).toLocaleString(), 'Total miles')]);
  }

  /* ---------- period ---------- */
  const today = () => (st.status && st.status.today) || C.laDate(Date.now());
  function presetRange(p) {
    const t = today(), y = C.addDays(t, -1);
    if (p === 'month') return { start: t.slice(0, 8) + '01', end: t };
    if (p === 'lastmonth') { const first = t.slice(0, 8) + '01', end = C.addDays(first, -1); return { start: end.slice(0, 8) + '01', end }; }
    return { start: C.addDays(y, -(Number(p) - 1)), end: y };
  }
  function applyPreset() { const p = $('preset').value; if (p !== 'custom') { const r = presetRange(p); $('start').value = r.start; $('end').value = r.end; } }

  /* ---------- data ---------- */
  function notice(kind, text) { const n = $('notice'); n.className = 'notice' + (kind ? ' ' + kind : ''); n.textContent = text || ''; n.hidden = !text; }
  async function api(path) {
    const res = await fetch(path, { headers: { Accept: 'application/json' } });
    if (res.status === 401) { location.href = '/login'; throw new Error('Signed out.'); }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || 'The request failed.');
    return j;
  }
  async function load(refresh) {
    if (st.loading) return;
    const start = $('start').value, end = $('end').value;
    if (!start || !end || end < start) return notice('', 'Choose a start date and an end date on or after it.');
    st.faults = null; st.faultsErr = ''; st.hos = null; st.hosErr = ''; st.eld = null; st.eldErr = '';
    st.loading = true; $('run').disabled = true; $('run').textContent = 'Loading from Samsara'; notice('', '');
    try {
      st.report = await api('/api/report?start=' + start + '&end=' + end + (refresh ? '&refresh=1' : ''));
      try { localStorage.setItem('pti.period', JSON.stringify({ preset: $('preset').value, start, end })); } catch (e) { /* optional */ }
      fillFilters();
      if (st.report.example) notice('', 'Showing two example shifts from Nov 23, 2026. Add the Samsara API key in Replit Secrets to see live data.');
      else if (st.report.issues.length) notice('', 'Some data is missing, so totals may be incomplete. ' + st.report.issues.join(' '));
    } catch (e) { notice('bad', e.message + ' Open Connection check for details.'); }
    finally { st.loading = false; $('run').disabled = false; $('run').textContent = 'Run report'; render(); }
  }
  function fillFilters() {
    const S = st.report.shifts;
    const fill = (id, all, values) => {
      const sel = $(id), keep = sel.value; sel.textContent = ''; sel.appendChild(new Option(all, ''));
      [...new Set(values)].sort().forEach(v => sel.appendChild(new Option(v, v)));
      sel.value = [...sel.options].some(o => o.value === keep) ? keep : '';
    };
    fill('f-driver', 'All drivers', S.map(s => s.driver));
    fill('f-truck', 'All trucks', [].concat(...S.map(s => s.vehicle.split(' / '))));
    fill('f-yard', 'All yards', S.map(s => s.startYard));
  }
  function shifts() {
    if (!st.report) return [];
    const d = $('f-driver').value, t = $('f-truck').value, y = $('f-yard').value, f = $('f-flag').checked;
    return st.report.shifts.filter(s => (!d || s.driver === d) && (!t || s.vehicle.split(' / ').includes(t)) && (!y || s.startYard === y) && (!f || s.flags.some(C.isOverLimit)));
  }

  /* ---------- duty strip: where the shift's time went ---------- */
  function strip(s, scaleMs, big) {
    const total = scaleMs || s.dur, box = el('div', { class: 'strip' + (big ? ' big' : ''), role: 'img', 'aria-label': 'Shift time bar: ' + D(s.dur) + ' yard to yard, ' + D(s.drive) + ' driving, ' + D(s.onSite) + ' on site' });
    const seg = (a, b, cls, title) => { if (b > a) box.appendChild(el('i', { class: cls, title, style: 'left:' + ((a - s.s) / total * 100) + '%;width:' + ((b - a) / total * 100) + '%' })); };
    let prev = s.s;
    for (const l of s.legs) {
      seg(prev, l.arr, 'd', 'Travel to ' + l.name + ': ' + D(l.arr - prev));
      if (!l.isReturn) { seg(l.arr, l.dep, l.yardVisit ? 'y' : 's', l.name + ': ' + D(l.dep - l.arr)); prev = l.dep; }
    }
    if (scaleMs && scaleMs > C.RULES.maxShift) box.appendChild(el('i', { class: 'lim', title: '16 hour limit', style: 'left:' + (C.RULES.maxShift / total * 100) + '%' }));
    return box;
  }
  const STRIP_SCALE = 18 * C.H;
  function legend() {
    return el('div', { class: 'legend' }, [
      el('span', {}, [el('i', { style: 'background:var(--drive)' }), 'Travel']), el('span', {}, [el('i', { style: 'background:var(--site)' }), 'On site']),
      el('span', {}, [el('i', { style: 'background:var(--yard)' }), 'At yard mid-shift']), el('span', {}, [el('i', { style: 'background:var(--over)' }), '16 hour limit'])]);
  }
  function pills(flags) { return flags.map(f => el('span', { class: 'pill' + (C.isOverLimit(f) || /mid-shift|away from a yard|after leaving|long after|Timesheet higher|no ELD shift/.test(f) || /^(Stop|Protect|Active|Out of hours)$/.test(f) ? ' hot' : ''), text: f })); }

  /* ---------- ELD shift hours: the timesheet check ---------- */
  const REVIEW = /Over 16h|over 10h|mid-shift|under 10h|away from a yard|after leaving|long after/i;
  const q25 = ms => (Math.round(ms / C.H * 4) / 4).toFixed(2), mins = ms => (ms == null ? '' : String(Math.round(ms / C.MIN)));
  async function loadEld(refresh) {
    if (st.eldLoading) return; const start = $('start').value, end = $('end').value; if (!start || !end || end < start) return;
    st.eldLoading = true; st.eldErr = '';
    try { st.eld = await api('/api/eldshifts?start=' + start + '&end=' + end + (refresh ? '&refresh=1' : '')); } catch (e) { st.eld = null; st.eldErr = e.message; }
    finally { st.eldLoading = false; if (st.view === 'eld' || st.view === 'eldday') render(); }
  }
  function eldRows() {
    if (!st.eld) return []; const d = $('f-driver').value, t = $('f-truck').value;
    return st.eld.rows.filter(r => (!d || r.driver === d) && (!t || (r.truck || '').split(' / ').includes(t)) && (!st.reviewOnly || r.flags.some(f => REVIEW.test(f))));
  }
  function eldDayRows() {
    const m = new Map();
    for (const s of eldRows()) { const k = s.driverId + '|' + s.date, r = m.get(k) || { driver: s.driver, date: s.date, shifts: 0, span: 0, onDuty: 0, drive: 0, flags: new Set() };
      r.shifts++; r.span += s.span; r.onDuty += s.onDuty; r.drive += s.drive; s.flags.filter(f => REVIEW.test(f)).forEach(f => r.flags.add(f)); m.set(k, r); }
    return [...m.values()].sort((a, b) => a.driver.localeCompare(b.driver) || (a.date < b.date ? -1 : 1));
  }
  function eldView(key) {
    if (st.eldErr) return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: st.eldErr + ' Open Connection check for details.' })]);
    if (!st.eld) { loadEld(); return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: 'Loading ELD logs and yard trips from Samsara. A long period can take a minute.' })]); }
    if (st.eld.example) return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: 'Shift hours from the ELD need live Samsara data.' })]);
    const R = eldRows();
    const rev = R.filter(r => r.flags.some(f => REVIEW.test(f))).length, hrs = R.reduce((a, r) => a + r.span, 0);
    return el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [
      el('section', { class: 'band', style: 'grid-template-columns:repeat(5,minmax(0,1fr))' }, [tile(R.length, 'Finished shifts'), tile(new Set(R.map(r => r.driverId)).size, 'Drivers'), tile(Math.round(hrs / C.H).toLocaleString(), 'Total shift hours'),
        tile(R.length ? (hrs / R.length / C.H).toFixed(1) : '0', 'Average shift, hours'), tile(rev, 'Shifts to review', rev > 0)]),
      tableView(key)]);
  }

  /* ---------- compare to hand-filled timesheets ---------- */
  function tsLoad() { if (st.ts) return st.ts; try { st.ts = JSON.parse(localStorage.getItem('pti.timesheets') || '{}'); } catch (e) { st.ts = {}; } return st.ts; }
  function tsSave() { try { localStorage.setItem('pti.timesheets', JSON.stringify(st.ts)); } catch (e) { st.tsMsg += ' The hours could not be saved in this browser, so they will be gone after a refresh.'; } }
  async function tsImport(file) {
    try {
      const list = await Timesheet.readRecap(file), ts = tsLoad(); let days = 0;
      for (const d of list) { const k = Timesheet.nameKey(d.name), cur = ts[k] || { name: d.name, days: {} }; cur.name = d.name; Object.assign(cur.days, d.days); ts[k] = cur; days += Object.keys(d.days).length; }
      const all = [].concat(...list.map(d => Object.keys(d.days))).sort();
      st.tsMsg = 'Imported ' + list.length + ' drivers and ' + days + ' days, ' + all[0] + ' through ' + all[all.length - 1] + '.'; tsSave();
    } catch (e) { st.tsMsg = e.message || 'That file could not be read.'; }
    render();
  }
  function tsRows() {
    if (!st.eld || st.eld.example) return [];
    const ts = tsLoad(), tol = st.tol / 60, dsel = $('f-driver').value, eldBy = new Map(), eldNames = new Map();
    for (const s of st.eld.rows) { const k = Timesheet.nameKey(s.driver); eldNames.set(k, s.driver); const kk = k + '|' + s.date, r = eldBy.get(kk) || { span: 0, drive: 0, flags: new Set(), n: 0 }; r.span += s.span; r.drive += s.drive; r.n++; s.flags.filter(f => REVIEW.test(f)).forEach(f => r.flags.add(f)); eldBy.set(kk, r); }
    const rows = [];
    for (const k of Object.keys(ts)) {
      const d = ts[k], shown = eldNames.get(k) || d.name;
      if (dsel && shown !== dsel) continue;
      for (const date of Object.keys(d.days)) {
        if (date < st.eld.start || date > st.eld.end) continue;
        const t = d.days[date], e = eldBy.get(k + '|' + date), eh = e ? e.span / C.H : 0;
        if (!t && !e) continue;
        const diff = t - eh;
        const status = !e ? 'Hours claimed, no ELD shift' : !t ? 'ELD shift, no hours claimed' : Math.abs(diff) <= tol ? 'Match' : diff > 0 ? 'Timesheet higher' : 'Timesheet lower';
        rows.push({ driver: shown, date, t, eh: e ? eh : null, diff, status, drive: e ? e.drive : null, shifts: e ? e.n : 0, flags: e ? [...e.flags] : [] });
      }
    }
    rows.sort((a, b) => a.driver.localeCompare(b.driver) || (a.date < b.date ? -1 : 1));
    return st.diffOnly ? rows.filter(r => r.status !== 'Match') : rows;
  }
  function tsView() {
    if (st.eldErr) return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: st.eldErr + ' Open Connection check for details.' })]);
    const ts = tsLoad(), have = Object.keys(ts).length;
    const input = el('input', { type: 'file', accept: '.xlsx', 'aria-label': 'Driver Recap workbook', onchange: e => { if (e.target.files[0]) tsImport(e.target.files[0]); } });
    const importer = el('section', { class: 'panel' }, [el('header', {}, [el('h2', { text: 'Driver-reported hours' }), el('span', { class: 'hint', text: have ? have + ' drivers saved in this browser' : 'Nothing imported yet' })]),
      el('div', { class: 'tools', style: 'border:0' }, [el('label', { class: 'field' }, ['Driver Recap workbook (.xlsx)', input]),
        el('label', { class: 'field' }, ['Count as a match within', el('select', { onchange: e => { st.tol = +e.target.value; render(); } }, [15, 30, 45, 60].map(m => { const o = new Option(m + ' minutes', m); o.selected = m === st.tol; return o; }))]),
        have ? el('button', { type: 'button', class: 'btn', text: 'Clear imported hours', onclick: () => { st.ts = {}; tsSave(); st.tsMsg = 'Imported hours cleared.'; render(); } }) : null,
        el('span', { class: 'msg', role: 'status', text: st.tsMsg })]),
      el('div', { class: 'body', style: 'padding-top:0' }, [el('p', { class: 'hint', style: 'margin:0;max-width:80ch', text: 'Only the driver name, the dates and the Total Hours row are read. The file is opened in this browser and is not uploaded; pay figures in it are ignored. Imported hours are kept in this browser only.' })])]);
    if (!st.eld) { loadEld(); return el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [importer, el('section', { class: 'panel' }, [el('div', { class: 'empty', text: 'Loading ELD shifts from Samsara.' })])]); }
    if (st.eld.example) return el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [importer, el('section', { class: 'panel' }, [el('div', { class: 'empty', text: 'Comparing needs live Samsara data.' })])]);
    const keep = st.diffOnly; st.diffOnly = false; const all = tsRows(); st.diffOnly = keep;
    const n = s => all.filter(r => r.status === s), hi = n('Timesheet higher'), lo = n('Timesheet lower');
    const band = el('section', { class: 'band', style: 'grid-template-columns:repeat(5,minmax(0,1fr))' }, [tile(all.length, 'Driver days compared'), tile(n('Match').length, 'Match within ' + st.tol + ' minutes'),
      tile(hi.length, 'Timesheet higher, ' + hi.reduce((a, r) => a + r.diff, 0).toFixed(1) + ' hours over', hi.length > 0), tile(lo.length, 'Timesheet lower, ' + Math.abs(lo.reduce((a, r) => a + r.diff, 0)).toFixed(1) + ' hours under'),
      tile(n('Hours claimed, no ELD shift').length + n('ELD shift, no hours claimed').length, 'One side missing')]);
    const unmatched = Object.keys(ts).filter(k => !st.eld.rows.some(s => Timesheet.nameKey(s.driver) === k)).map(k => ts[k].name);
    return el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [importer,
      have && unmatched.length ? el('div', { class: 'notice', text: unmatched.length + ' drivers on the sheet have no ELD shifts in this period under the same name: ' + unmatched.slice(0, 12).join('; ') + (unmatched.length > 12 ? '; and ' + (unmatched.length - 12) + ' more' : '') + '.' }) : null,
      have ? band : null, have ? tableView('tscheck') : null]);
  }

  /* ---------- 80-hour clock (California intrastate, flammable tank vehicle) ---------- */
  const h1 = ms => (ms / C.H).toFixed(1);
  async function loadHos(refresh) {
    if (st.hosLoading) return; const end = $('end').value; if (!end) return;
    st.hosLoading = true; st.hosErr = '';
    try { st.hos = await api('/api/hos?end=' + end + (refresh ? '&refresh=1' : '')); } catch (e) { st.hos = null; st.hosErr = e.message; }
    finally { st.hosLoading = false; if (st.view === 'hos') render(); }
  }
  function hosRows() { if (!st.hos) return []; const d = $('f-driver').value; return st.hos.rows.filter(r => !d || r.driver === d); }
  const hosStatus = r => (r.inReset ? 'On 34h reset' : r.left <= 0 ? 'Out of hours' : r.left < 16 * C.H ? 'Under 16h left' : '');
  function hosView() {
    if (st.hosErr) return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: st.hosErr + ' Open Connection check for details.' })]);
    if (!st.hos) { loadHos(); return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: 'Loading hours-of-service logs from Samsara.' })]); }
    if (st.hos.example) return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: 'The 80-hour clock needs live Samsara data.' })]);
    const R = hosRows();
    const out = R.filter(r => !r.inReset && r.left <= 0).length, low = R.filter(r => !r.inReset && r.left > 0 && r.left < 16 * C.H).length, viol = R.reduce((a, r) => a + r.overDrive + r.pastWindow, 0);
    return el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [
      el('section', { class: 'band', style: 'grid-template-columns:repeat(5,minmax(0,1fr))' }, [tile(R.length, 'Drivers on duty in these 8 days'), tile(out, 'At or over 80 hours', out > 0), tile(low, 'Under 16 hours left'),
        tile(R.filter(r => r.inReset).length, 'On a 34-hour reset now'), tile(viol, 'Work periods over 10h driving or past hour 16', viol > 0)]),
      tableView('hos')]);
  }

  /* ---------- fault history ---------- */
  async function loadFaults(refresh) {
    if (st.faultsLoading) return;
    const start = $('start').value, end = $('end').value; if (!start || !end || end < start) return;
    st.faultsLoading = true; st.faultsErr = '';
    try { st.faults = await api('/api/faults?start=' + start + '&end=' + end + (refresh ? '&refresh=1' : '')); }
    catch (e) { st.faults = null; st.faultsErr = e.message; }
    finally { st.faultsLoading = false; if (st.view === 'faults') render(); }
  }
  function faultRows() {
    if (!st.faults) return [];
    const t = $('f-truck').value;
    return st.faults.rows.filter(r => (!t || r.truck === t) && (!st.activeOnly || r.active));
  }
  const RED = /Stop|Protect/;
  function faultsView() {
    if (st.faultsErr) return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: st.faultsErr + ' Open Connection check for details.' })]);
    if (!st.faults) { loadFaults(); return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: 'Loading fault codes from Samsara. A long period can take a minute.' })]); }
    if (st.faults.example) return el('section', { class: 'panel' }, [el('div', { class: 'empty', text: 'Fault history needs live Samsara data. There are no example faults.' })]);
    const R = faultRows();
    const act = R.filter(r => r.active), red = act.filter(r => r.lamps.some(x => RED.test(x)));
    const band = el('section', { class: 'band', style: 'grid-template-columns:repeat(5,minmax(0,1fr))' }, [
      tile(new Set(R.map(r => r.truck)).size, 'Trucks that reported a fault'), tile(R.length, 'Fault episodes'), tile(act.length, 'Still active at end of period'),
      tile(new Set(act.map(r => r.truck)).size, 'Trucks with an active fault'), tile(red.length, 'Active with a stop or protect lamp', red.length > 0)]);
    return el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [band, tableView('faults')]);
  }

  /* ---------- analysis: every saved stop to the next saved stop ---------- */
  const sp = v => (v == null ? '' : v.toFixed(1));
  function hops() {
    const out = [];
    for (const s of shifts()) s.legs.forEach((l, i) => {
      const prev = i ? s.legs[i - 1] : null, from = prev ? C.label(prev.place) : s.startYard, to = C.label(l.place);
      if (from === to) return;
      out.push({ s, from, to, drive: l.drive, m: l.m, via: l.via || 0, viaTime: l.viaTime || 0, dep: prev ? prev.dep : s.s, arr: l.arr,
        span: prev && l.dep != null ? l.dep - prev.arr : null });
    });
    return st.direct ? out.filter(h => !h.via) : out;
  }
  function agg(list) {
    const n = list.length, sum = f => list.reduce((a, x) => a + f(x), 0), drive = sum(h => h.drive), m = sum(h => h.m);
    const spans = list.filter(h => h.span != null);
    return { n, drive: n ? drive / n : null, min: n ? Math.min(...list.map(h => h.drive)) : null, max: n ? Math.max(...list.map(h => h.drive)) : null,
      m: n ? m / n : null, mph: C.mph(m, drive), span: spans.length ? spans.reduce((a, h) => a + h.span, 0) / spans.length : null, spanN: spans.length,
      drivers: new Set(list.map(h => h.s.driverId)).size };
  }
  function laneRows() {
    const m = new Map();
    for (const h of hops()) { const k = h.from + '→' + h.to; (m.get(k) || m.set(k, []).get(k)).push(h); }
    return [...m.values()].map(list => Object.assign({ from: list[0].from, to: list[0].to }, agg(list))).sort((a, b) => b.n - a.n);
  }
  function siteRows() {
    const m = new Map();
    for (const s of shifts()) for (const l of s.legs) { if (l.isReturn) continue; const k = C.label(l.place) + (l.yardVisit ? ' (mid-shift return)' : ''); (m.get(k) || m.set(k, []).get(k)).push({ t: l.onSite, d: s.driverId }); }
    return [...m.entries()].map(([site, v]) => {
      const t = v.map(x => x.t).sort((a, b) => a - b), n = t.length;
      return { site, n, avg: t.reduce((a, x) => a + x, 0) / n, med: n % 2 ? t[(n - 1) / 2] : (t[n / 2 - 1] + t[n / 2]) / 2, min: t[0], max: t[n - 1], total: t.reduce((a, x) => a + x, 0), over1: t.filter(x => x > C.H).length, drivers: new Set(v.map(x => x.d)).size };
    }).sort((a, b) => b.total - a.total);
  }
  function directToggle() {
    return el('label', { class: 'check' }, [el('input', Object.assign({ type: 'checkbox', onchange: e => { st.direct = e.target.checked; render(); } }, st.direct ? { checked: '' } : {})), 'Direct trips only (no unsaved stops on the way)']);
  }

  /* ---------- tables: [heading, value, screen format, right-align, CSV format, special] ---------- */
  const hos = (s, f) => (s.hos && !s.hos.none ? f(s.hos) : null);
  const TABLES = {
    shifts: {
      file: 'shifts', rows: () => shifts(), open: r => r, defaultSort: { i: 5, dir: -1 }, cols: [
        ['Shift', s => s.num, null, 1], ['Shift date', s => s.date], ['Driver', s => s.driver], ['Truck', s => s.vehicle],
        ['Start yard', s => s.startYard], ['Departed', s => s.s, C.fmtDT, 1, C.fmtDTcsv], ['End yard', s => s.endYard, null, 0, null, 'csv'], ['Returned', s => s.e, C.fmtDT, 1, C.fmtDTcsv],
        ['Hours worked', s => s.dur, D, 1, C.fmtDur], ['Hours worked (decimal)', s => s.dur, C.hrs, 1, C.hrs, 'csv'], ['Where the time went', s => s.dur, null, 0, null, 'strip'],
        ['Stops', s => s.stops, null, 1], ['Drive time', s => s.drive, D, 1, C.fmtDur], ['Time on site', s => s.onSite, D, 1, C.fmtDur], ['Unsaved stop time', s => s.unlisted + s.yardTime, D, 1, C.fmtDur], ['Miles', s => s.meters, mi, 1, mi], ['Avg driving speed (mph)', s => C.mph(s.meters, s.drive), sp, 1],
        ['Rest before shift', s => hos(s, h => h.restBefore), (v, s) => (v == null ? '' : (s.hos.restBeforeOpen ? 'over ' : '') + D(v)), 1, v => (v == null ? '' : C.hrs(v))],
        ['ELD on duty from', s => hos(s, h => h.clockIn), C.fmtDT, 1, C.fmtDTcsv, 'csv'], ['ELD off duty at', s => hos(s, h => h.clockOut), C.fmtDT, 1, C.fmtDTcsv, 'csv'],
        ['ELD on-duty time', s => hos(s, h => h.onDuty), D, 1, C.fmtDur], ['ELD driving', s => hos(s, h => h.drive), D, 1, C.fmtDur], ['ELD breaks', s => hos(s, h => h.breaks), D, 1, C.fmtDur, 'csv'],
        ['Flags', s => s.flags.join('; '), null, 0, null, 'flags']]
    },
    stops: {
      file: 'stops', rows: () => [].concat(...shifts().map(s => s.legs.map(l => ({ s, l })))), open: r => r.s, cols: [
        ['Shift', r => r.s.num, null, 1], ['Shift date', r => r.s.date], ['Driver', r => r.s.driver], ['Truck', r => r.s.vehicle], ['Leg', r => r.l.leg, null, 1],
        ['From', r => r.l.from], ['Stop', r => r.l.name], ['Arrived', r => r.l.arr, C.fmtDT, 1, C.fmtDTcsv], ['Departed', r => r.l.dep, C.fmtDT, 1, C.fmtDTcsv],
        ['Time on site', r => r.l.onSite, D, 1, C.fmtDur], ['Drive from previous', r => r.l.drive, D, 1, C.fmtDur], ['Miles from previous', r => r.l.m, mi, 1, mi]]
    },
    daily: {
      file: 'hours-by-day', rows: () => C.dailyHours(shifts()), cols: [
        ['Shift date', d => d.date], ['Driver', d => d.driver], ['Shifts', d => d.shifts, null, 1], ['Hours worked', d => d.dur, D, 1, C.fmtDur], ['Hours worked (decimal)', d => d.dur, C.hrs, 1, C.hrs],
        ['Drive time', d => d.drive, D, 1, C.fmtDur], ['Time on site', d => d.onSite, D, 1, C.fmtDur], ['Stops', d => d.stops, null, 1], ['Miles', d => d.meters, mi, 1, mi],
        ['ELD on-duty time', d => d.hosOnDuty, D, 1, C.fmtDur], ['ELD driving', d => d.hosDrive, D, 1, C.fmtDur], ['Flags', d => [...d.flags].join('; '), null, 0, null, 'flags']]
    },
    totals: {
      file: 'driver-totals', rows: () => C.driverTotals(shifts()), cols: [
        ['Driver', d => d.driver], ['Days worked', d => d.days.size, null, 1], ['Shifts', d => d.shifts, null, 1], ['Total hours worked', d => d.dur, D, 1, C.fmtDur], ['Total hours (decimal)', d => d.dur, C.hrs, 1, C.hrs],
        ['Average shift', d => d.dur / d.shifts, D, 1, C.fmtDur], ['Longest shift', d => d.longest, D, 1, C.fmtDur], ['Drive time', d => d.drive, D, 1, C.fmtDur], ['Time on site', d => d.onSite, D, 1, C.fmtDur],
        ['Miles', d => d.meters, mi, 1, mi], ['Avg driving speed (mph)', d => C.mph(d.meters, d.drive), sp, 1], ['ELD on-duty time', d => d.hosOnDuty, D, 1, C.fmtDur], ['Shifts over 16h', d => d.over16, null, 1], ['Shifts over 10h driving', d => d.over10, null, 1],
        ['Starts with under 10h rest', d => d.shortRest, null, 1], ['34h restarts', d => d.restarts, null, 1]]
    },
    sites: {
      file: 'time-on-site', rows: siteRows, cols: [
        ['Site', r => r.site], ['Visits', r => r.n, null, 1], ['Avg time on site', r => r.avg, D, 1, C.fmtDur], ['Typical (median)', r => r.med, D, 1, C.fmtDur], ['Shortest', r => r.min, D, 1, C.fmtDur], ['Longest', r => r.max, D, 1, C.fmtDur],
        ['Visits over 1 hour', r => r.over1, null, 1], ['Total time on site', r => r.total, D, 1, C.fmtDur], ['Total (decimal hours)', r => r.total, C.hrs, 1, C.hrs, 'csv'], ['Drivers', r => r.drivers, null, 1]]
    },
    lanes: {
      file: 'point-to-point', rows: laneRows, extra: directToggle, onRow: r => { st.a = r.from; st.b = r.to; go('compare'); }, cols: [
        ['From', r => r.from], ['To', r => r.to], ['Trips', r => r.n, null, 1], ['Avg drive time', r => r.drive, D, 1, C.fmtDur], ['Fastest', r => r.min, D, 1, C.fmtDur], ['Slowest', r => r.max, D, 1, C.fmtDur],
        ['Avg miles', r => r.m, mi, 1, mi], ['Avg speed (mph)', r => r.mph, sp, 1], ['Avg arrive at From to depart To', r => r.span, D, 1, C.fmtDur], ['Drivers', r => r.drivers, null, 1]]
    },
    eld: {
      file: 'shift-hours-eld', rows: eldRows, defaultSort: { i: 3, dir: -1 },
      extra: () => el('label', { class: 'check' }, [el('input', Object.assign({ type: 'checkbox', onchange: e => { st.reviewOnly = e.target.checked; render(); } }, st.reviewOnly ? { checked: '' } : {})), 'Shifts to review only']),
      cols: [
        ['Shift date', r => r.date], ['Driver', r => r.driver], ['Truck', r => r.truck], ['On duty at', r => r.s, C.fmtDT, 1, C.fmtDTcsv], ['Started at', r => (r.startPlace == null ? 'Unknown' : r.startPlace || 'Away from yard')],
        ['Off duty at', r => r.e, C.fmtDT, 1, C.fmtDTcsv], ['Ended at', r => (r.endPlace == null ? 'Unknown' : r.endPlace || 'Away from yard')],
        ['Total shift hours', r => r.span, D, 1, C.hrs], ['To nearest quarter hour', r => r.span, q25, 1], ['On-duty time', r => r.onDuty, D, 1, C.hrs], ['Drive time', r => r.drive, D, 1, C.hrs],
        ['Off-duty breaks', r => r.breakCount, null, 1], ['Break time', r => r.breakTime, D, 1, C.hrs], ['Longest break', r => r.longestBreak, D, 1, C.hrs],
        ['Left yard', r => r.yardOut, C.fmtDT, 1, C.fmtDTcsv], ['Back at yard', r => r.yardIn, C.fmtDT, 1, C.fmtDTcsv], ['Yard to yard hours', r => r.yardSpan, D, 1, C.hrs],
        ['Minutes on duty before leaving yard', r => (r.yardOut == null ? null : r.yardOut - r.s), mins, 1], ['Minutes on duty after return', r => (r.yardIn == null ? null : r.e - r.yardIn), mins, 1],
        ['Rest before', r => r.restBefore, (v, r) => (r.restBeforeOpen ? '' : D(v)), 1, (v, r) => (r.restBeforeOpen ? '' : C.hrs(v))], ['Rest after', r => r.restAfter, (v, r) => (r.restAfterOpen ? 'over ' : '') + D(v), 1, C.hrs],
        ['Flags', r => r.flags.join('; '), null, 0, null, 'flags']]
    },
    eldday: {
      file: 'hours-by-driver-and-day', rows: eldDayRows, cols: [
        ['Driver', r => r.driver], ['Shift date', r => r.date], ['Shifts', r => r.shifts, null, 1], ['Total shift hours', r => r.span, C.hrs, 1], ['To nearest quarter hour', r => r.span, q25, 1],
        ['On-duty hours', r => r.onDuty, C.hrs, 1], ['Drive hours', r => r.drive, C.hrs, 1], ['Flags', r => [...r.flags].join('; '), null, 0, null, 'flags']]
    },
    tscheck: {
      file: 'timesheet-check', rows: tsRows,
      extra: () => el('label', { class: 'check' }, [el('input', Object.assign({ type: 'checkbox', onchange: e => { st.diffOnly = e.target.checked; render(); } }, st.diffOnly ? { checked: '' } : {})), 'Differences only']),
      cols: [['Driver', r => r.driver], ['Shift date', r => r.date], ['Timesheet hours', r => r.t, v => v.toFixed(2), 1], ['ELD shift hours', r => r.eh, v => v.toFixed(2), 1], ['Difference (timesheet minus ELD)', r => r.diff, v => (v > 0 ? '+' : '') + v.toFixed(2), 1],
        ['Result', r => r.status, null, 0, null, 'flags'], ['ELD drive hours', r => r.drive, C.hrs, 1], ['ELD shifts that day', r => r.shifts, null, 1], ['ELD flags', r => r.flags.join('; '), null, 0, null, 'flags']]
    },
    hos: {
      file: '80-hour-clock', rows: hosRows, defaultSort: { i: 3, dir: 1 },
      get cols() {
        const days = (st.hos && st.hos.dayLabels) || [];
        return [['Driver', r => r.driver], ['Status', r => hosStatus(r), null, 0, null, 'flags'], ['On duty, 8 days (hours)', r => r.used, h1, 1], ['Hours left of 80', r => r.left, h1, 1]]
          .concat(days.map((d, i) => [Number(d.slice(5, 7)) + '/' + Number(d.slice(8)), r => r.days[i], v => (v ? h1(v) : ''), 1, h1]))
          .concat([['Days worked in a row', r => r.streak, null, 1], ['Last 34h reset ended', r => r.resetEnd, C.fmtDT, 1, C.fmtDTcsv], ['Over 10h driving', r => r.overDrive || null, null, 1], ['Drove past hour 16', r => r.pastWindow || null, null, 1]]);
      }
    },
    faults: {
      file: 'fault-history', rows: faultRows, defaultSort: { i: 6, dir: -1 },
      extra: () => el('label', { class: 'check' }, [el('input', Object.assign({ type: 'checkbox', onchange: e => { st.activeOnly = e.target.checked; render(); } }, st.activeOnly ? { checked: '' } : {})), 'Still active only']),
      cols: [
        ['Truck', r => r.truck], ['Status', r => (r.active ? 'Active' : 'Cleared'), null, 0, null, 'flags'], ['Code', r => r.code], ['Description', r => r.description], ['Reported by', r => r.source],
        ['First seen', r => r.first, C.fmtDT, 1, C.fmtDTcsv], ['Last seen', r => r.last, C.fmtDT, 1, C.fmtDTcsv], ['Cleared', r => r.cleared, C.fmtDT, 1, C.fmtDTcsv],
        ['Lasted', r => (r.cleared || r.last) - r.first, D, 1, C.fmtDur], ['Occurrence count', r => r.count || null, null, 1], ['Lamps', r => r.lamps.join('; '), null, 0, null, 'flags']]
    },
    pair: {
      file: 'trips-between', rows: () => hops().filter(h => (h.from === st.a && h.to === st.b) || (h.from === st.b && h.to === st.a)), open: r => r.s, defaultSort: { i: 5, dir: -1 }, cols: [
        ['Shift date', r => r.s.date], ['Driver', r => r.s.driver], ['Truck', r => r.s.vehicle], ['From', r => r.from], ['To', r => r.to], ['Left', r => r.dep, C.fmtDT, 1, C.fmtDTcsv], ['Arrived', r => r.arr, C.fmtDT, 1, C.fmtDTcsv],
        ['Drive time', r => r.drive, D, 1, C.fmtDur], ['Miles', r => r.m, mi, 1, mi], ['Speed (mph)', r => C.mph(r.m, r.drive), sp, 1], ['Arrive at From to depart To', r => r.span, D, 1, C.fmtDur], ['Unsaved stops on the way', r => r.via, null, 1]]
    }
  };
  const ctx = r => (r.l ? r.s : r);
  const rowShift = r => (r.s || r);
  const show = (c, r) => { const v = c[1](r); return v == null ? '' : String(c[2] ? c[2](v, ctx(r)) : v); };
  const csvv = (c, r) => { const v = c[1](r); return v == null ? '' : String(c[4] ? c[4](v, ctx(r)) : (c[2] ? c[2](v, ctx(r)) : v)); };
  function tableRows(key) {
    const t = TABLES[key], q = st.q.trim().toLowerCase(); let rows = t.rows();
    if (q) rows = rows.filter(r => t.cols.some(c => show(c, r).toLowerCase().includes(q)));
    const so = st.sort[key] || t.defaultSort;
    if (so) { const c = t.cols[so.i]; rows = rows.slice().sort((a, b) => { const x = c[1](a), y = c[1](b); return ((x == null) - (y == null)) || so.dir * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))); }); }
    return rows;
  }
  function csvText(key) {
    const t = TABLES[key], q = v => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v), rows = tableRows(key);
    const cols = t.cols.filter(c => c[5] !== 'strip');
    return { n: rows.length, text: '﻿' + [cols.map(c => q(c[0])).join(',')].concat(rows.map(r => cols.map(c => q(csvv(c, r))).join(','))).join('\r\n') + '\r\n' };
  }
  function downloadCsv(key, msg) {
    const out = csvText(key), r = key === 'faults' ? st.faults : key === 'hos' ? { start: st.hos.dayLabels[0], end: st.hos.dayLabels[7] } : key === 'eld' || key === 'eldday' || key === 'tscheck' ? st.eld : st.report;
    const a = el('a', { href: URL.createObjectURL(new Blob([out.text], { type: 'text/csv;charset=utf-8' })), download: 'pti-' + TABLES[key].file + '_' + r.start + '_to_' + r.end + '.csv' });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    msg.textContent = 'Downloaded ' + out.n.toLocaleString() + ' rows.';
  }
  function tableView(key) {
    const t = TABLES[key], rows = tableRows(key), so = st.sort[key] || t.defaultSort, max = 2000;
    const msg = el('span', { class: 'msg', role: 'status' });
    const search = el('input', { type: 'search', placeholder: 'Search this table', 'aria-label': 'Search this table', value: st.q, oninput: e => { st.q = e.target.value; const pos = e.target.selectionStart; render(); const s = document.querySelector('.tools input'); s.focus(); s.setSelectionRange(pos, pos); } });
    const head = el('tr', {}, t.cols.map((c, i) => c[5] === 'csv' ? null : el('th', { class: c[3] ? 'r' : '', 'aria-sort': so && so.i === i ? (so.dir > 0 ? 'ascending' : 'descending') : null },
      c[5] === 'strip' ? [el('button', { type: 'button', text: c[0], onclick: () => sortBy(key, i) })] : [el('button', { type: 'button', text: c[0] + (so && so.i === i ? (so.dir > 0 ? ' ↑' : ' ↓') : ''), onclick: () => sortBy(key, i) })])));
    const body = el('tbody', {}, rows.slice(0, max).map(r => {
      const tr = el('tr', { class: (r.l && r.l.isReturn ? 'ret ' : '') + (t.open || t.onRow ? 'click' : '') }, t.cols.map(c => {
        if (c[5] === 'csv') return null;
        if (c[5] === 'strip') return el('td', {}, [strip(r, Math.max(STRIP_SCALE, r.dur))]);
        if (c[5] === 'flags') return el('td', {}, pills(show(c, r).split('; ').filter(Boolean)));
        return el('td', { class: c[3] ? 'r' : '', text: show(c, r) });
      }));
      if (t.open || t.onRow) { tr.tabIndex = 0; const go = () => (t.onRow ? t.onRow(r) : openShift(t.open(r))); tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); }
      return tr;
    }));
    return el('section', { class: 'panel' }, [
      el('div', { class: 'tools' }, [search, el('span', { class: 'count', text: rows.length.toLocaleString() + (rows.length === 1 ? ' row' : ' rows') + (rows.length > max ? ' (first ' + max.toLocaleString() + ' shown, the CSV has all)' : '') }),
        key === 'shifts' ? legend() : null, t.extra ? t.extra() : null, el('span', { class: 'grow', style: 'flex:1' }), msg, el('button', { type: 'button', class: 'btn', text: 'Download CSV', onclick: () => downloadCsv(key, msg) })]),
      rows.length ? el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [head]), body])]) : el('div', { class: 'empty', text: key === 'tscheck' ? 'No days to compare. Check that the period above overlaps the dates on the imported sheet.' : key === 'hos' ? 'No drivers were on duty in these 8 days.' : key === 'faults' ? 'No fault codes were reported in this period with these filters.' : st.report ? 'No rows match. Clear the search or filters, or pick another period.' : 'Run a report to see data.' })]);
  }
  function sortBy(key, i) { const so = st.sort[key] || TABLES[key].defaultSort; st.sort[key] = so && so.i === i ? { i, dir: -so.dir } : { i, dir: 1 }; render(); }

  /* ---------- overview ---------- */
  function overview() {
    const S = shifts(), sum = f => S.reduce((a, s) => a + f(s), 0);
    const over = S.filter(s => s.flags.some(C.isOverLimit));
    const band = el('section', { class: 'band', 'aria-label': 'Totals for the period' }, [
      tile(S.length.toLocaleString(), 'Shifts'), tile(String(new Set(S.map(s => s.driverId)).size), 'Drivers'),
      tile(Math.round(sum(s => s.dur) / C.H).toLocaleString(), 'Hours worked, yard to yard'), tile(S.length ? D(sum(s => s.dur) / S.length) : '0m', 'Average shift'),
      tile(Math.round(C.miles(sum(s => s.meters))).toLocaleString(), 'Miles'), tile(String(over.length), 'Shifts over a limit', over.length > 0)]);
    if (!S.length) return el('div', {}, [band, el('section', { class: 'panel', style: 'margin-top:16px' }, [el('div', { class: 'empty', text: 'No shifts in this period with these filters.' })])]);

    // hours worked per shift date
    const days = []; for (let d = st.report.start; d <= st.report.end; d = C.addDays(d, 1)) days.push(d);
    const byDay = {}; for (const s of S) { const b = byDay[s.date] = byDay[s.date] || { dur: 0, n: 0, over: 0 }; b.dur += s.dur; b.n++; if (s.flags.some(C.isOverLimit)) b.over++; }
    const maxDay = Math.max(1, ...days.map(d => (byDay[d] ? byDay[d].dur : 0)));
    const every = Math.ceil(days.length / 14);
    const cols = el('div', { class: 'cols' }, days.map(d => {
      const b = byDay[d] || { dur: 0, n: 0, over: 0 };
      return el('div', { class: 'col', title: d + ': ' + (b.dur / C.H).toFixed(1) + ' hours across ' + b.n + ' shifts' + (b.over ? ', ' + b.over + ' over a limit' : '') }, [el('i', { class: b.over ? 'over' : '', style: 'height:' + (b.dur / maxDay * 100) + '%' })]);
    }));
    const colx = el('div', { class: 'colx' }, days.map((d, i) => el('span', { text: i % every === 0 ? Number(d.slice(5, 7)) + '/' + Number(d.slice(8)) : '' })));
    const dayPanel = el('section', { class: 'panel' }, [
      el('header', {}, [el('h2', { text: 'Hours worked by shift date' }), el('div', { class: 'legend' }, [el('span', {}, [el('i', { style: 'background:var(--drive)' }), 'All shifts within limits']), el('span', {}, [el('i', { style: 'background:var(--over)' }), 'A shift went over a limit'])])]),
      el('div', { class: 'body' }, [cols, colx, el('p', { class: 'hint', style: 'margin:8px 0 0', text: 'Tallest day: ' + (maxDay / C.H).toFixed(0) + ' hours. Hover a bar for the day’s numbers.' })])]);

    // hours by driver
    const tot = C.driverTotals(S).sort((a, b) => b.dur - a.dur), maxDrv = tot[0].dur;
    const rank = el('div', { class: 'rank' }); tot.slice(0, 15).forEach(d => { rank.appendChild(el('span', { class: 'name', text: d.driver, title: d.driver })); rank.appendChild(el('span', { class: 'track' }, [el('i', { style: 'width:' + (d.dur / maxDrv * 100) + '%' })])); rank.appendChild(el('span', { class: 'num', text: (d.dur / C.H).toFixed(1) + ' h' })); });
    const drvPanel = el('section', { class: 'panel' }, [
      el('header', {}, [el('h2', { text: 'Hours worked by driver' }), tot.length > 15 ? el('span', { class: 'hint', text: 'Top 15 of ' + tot.length }) : null]), el('div', { class: 'body' }, [rank])]);

    // shifts needing attention
    const attn = el('section', { class: 'panel' }, [
      el('header', {}, [el('h2', { text: 'Shifts over a limit' }), el('span', { class: 'hint', text: 'Over 16 hours, over 10 hours driving, or under 10 hours rest' })]),
      over.length ? el('ul', { class: 'attn' }, over.slice().sort((a, b) => b.s - a.s).slice(0, 25).map(s => el('li', {}, [el('button', { type: 'button', onclick: () => openShift(s) }, [
        el('b', { text: s.driver }), el('span', { text: s.date + ', truck ' + s.vehicle + ', ' + D(s.dur) }), ...pills(s.flags.filter(C.isOverLimit))])])))
        : el('div', { class: 'empty', text: 'No shifts went over a limit in this period.' })]);
    return el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [band, el('div', { class: 'grid2' }, [dayPanel, drvPanel]), attn]);
  }

  /* ---------- shift detail ---------- */
  let lastFocus = null;
  function closeDrawer() { $('drawer-root').textContent = ''; document.removeEventListener('keydown', escClose); if (lastFocus) lastFocus.focus(); }
  function escClose(e) { if (e.key === 'Escape') closeDrawer(); }
  function openShift(s) {
    lastFocus = document.activeElement;
    const fact = (k, v) => [el('div', {}, [el('dt', { text: k }), el('dd', { text: v || 'Not available' })])];
    const h = s.hos && !s.hos.none ? s.hos : null;
    const legs = el('ol', { class: 'legs' }, [el('li', { class: 'yard' }, [el('div', { class: 'where', text: 'Left ' + s.startYard }), el('div', { class: 'meta', text: C.fmtDT(s.s) })])].concat(s.legs.map(l =>
      el('li', { class: l.isReturn || l.yardVisit ? 'yard' : '' }, [el('div', { class: 'where', text: l.name }),
        el('div', { class: 'meta', text: 'Arrived ' + C.fmtTime(l.arr) + (l.isReturn ? '' : ', left ' + C.fmtTime(l.dep) + ', ' + D(l.onSite) + ' on site') }),
        el('div', { class: 'meta', text: D(l.drive) + ' driving and ' + mi(l.m) + ' miles from ' + l.from })]))));
    const close = el('button', { type: 'button', class: 'btn', text: 'Close', onclick: closeDrawer });
    const drawer = el('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Shift detail' }, [
      el('header', {}, [el('div', {}, [el('h2', { text: s.driver }), el('div', { class: 'sub', text: 'Shift ' + s.num + ', ' + s.date + ', truck ' + s.vehicle })]), close]),
      el('div', { class: 'inner' }, [
        s.flags.length ? el('div', {}, pills(s.flags)) : null,
        el('div', {}, [strip(s, null, true), el('div', { style: 'margin-top:6px' }, [legend()])]),
        el('dl', { class: 'facts' }, [].concat(fact('Hours worked', D(s.dur)), fact('Drive time', D(s.drive)), fact('Time on site', D(s.onSite)), fact('Miles', mi(s.meters)), fact('Avg driving speed', C.mph(s.meters, s.drive) == null ? '' : sp(C.mph(s.meters, s.drive)) + ' mph'), fact('Stops', String(s.stops)), fact('Unsaved stop time', D(s.unlisted + s.yardTime)),
          fact('Rest before shift', h && h.restBefore != null ? (h.restBeforeOpen ? 'over ' : '') + D(h.restBefore) : ''), fact('ELD on-duty time', h ? D(h.onDuty) : ''), fact('ELD driving', h ? D(h.drive) : ''))),
        el('h3', { style: 'margin:0;font:600 15px var(--head)', text: 'Stops in order' }), legs])]);
    $('drawer-root').textContent = '';
    $('drawer-root').appendChild(el('div', { class: 'scrim', onclick: closeDrawer })); $('drawer-root').appendChild(drawer);
    document.addEventListener('keydown', escClose); close.focus();
  }

  /* ---------- compare two locations ---------- */
  function compareView() {
    const names = new Set(); for (const s of st.report.shifts) { names.add(s.startYard); s.legs.forEach(l => names.add(C.label(l.place))); }
    const pick = (key, label) => { const sel = el('select', { onchange: e => { st[key] = e.target.value; render(); } }, [new Option('Choose a location', '')].concat([...names].sort().map(n => new Option(n, n)))); sel.value = st[key]; return el('label', { class: 'field' }, [label, sel]); };
    const controls = el('section', { class: 'panel' }, [el('div', { class: 'tools' }, [pick('a', 'Location A'), pick('b', 'Location B'),
      el('button', { type: 'button', class: 'btn', text: 'Swap A and B', onclick: () => { const t = st.a; st.a = st.b; st.b = t; render(); } }), directToggle()])]);
    if (!st.a || !st.b || st.a === st.b) return el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [controls, el('section', { class: 'panel' }, [el('div', { class: 'empty', text: 'Choose two different locations to see average miles, drive time and speed between them. You can also click any row on the Point to point page.' })])]);
    const all = hops(), dir = (f, t) => {
      const g = agg(all.filter(h => h.from === f && h.to === t));
      return el('section', { class: 'panel' }, [el('header', {}, [el('h2', { text: f + ' to ' + t }), el('span', { class: 'hint', text: g.n + (g.n === 1 ? ' trip' : ' trips') + ' by ' + g.drivers + (g.drivers === 1 ? ' driver' : ' drivers') })]),
        g.n ? el('div', { class: 'band', style: 'padding:14px 16px;grid-template-columns:repeat(5,minmax(0,1fr))' }, [tile(mi(g.m), 'Avg miles'), tile(D(g.drive), 'Avg drive time'), tile(sp(g.mph), 'Avg speed, mph'), tile(D(g.min) + ' to ' + D(g.max), 'Fastest to slowest'), tile(g.span == null ? 'n/a' : D(g.span), 'Avg arrive at ' + f + ' to depart ' + t)])
          : el('div', { class: 'empty', text: 'No trips in this direction for this period and these filters.' })]);
    };
    return el('div', { style: 'display:flex;flex-direction:column;gap:16px' }, [controls, dir(st.a, st.b), dir(st.b, st.a), tableView('pair')]);
  }

  /* ---------- setup pages ---------- */
  function checkView() {
    const list = el('ul', { class: 'checks' }), panel = el('section', { class: 'panel' }, [el('header', {}, [el('h2', { text: 'Samsara connection' }), el('span', { class: 'hint', text: 'Checking' })]), list]);
    api('/api/check').then(j => {
      panel.querySelector('.hint').textContent = j.live ? 'Checked just now' : '';
      if (!j.live) return list.appendChild(el('li', {}, [el('span', { class: 'no', text: '!' }), el('b', { text: 'API key' }), el('span', { text: 'No Samsara API key yet. In Replit, open Secrets and add SAMSARA_API_TOKEN, then restart the app.' })]));
      j.checks.forEach(c => list.appendChild(el('li', {}, [el('span', { class: c.ok ? 'ok' : 'no', text: c.ok ? '✓' : '✗' }), el('b', { text: c.name }), el('span', { text: c.detail })])));
    }).catch(e => { panel.querySelector('.hint').textContent = ''; list.appendChild(el('li', {}, [el('span', { class: 'no', text: '✗' }), el('b', { text: 'Connection' }), el('span', { text: e.message })])); });
    return panel;
  }
  function rulesView() {
    const items = [
      'A shift runs from when a truck leaves a yard (Bakersfield, Santa Maria or Coalinga) until it is back at one. Hours worked is that yard-to-yard time, and the shift date is the day the shift started, Pacific time.',
      'If a yard-to-yard run is under 4 hours and the same driver leaves again before a 10-hour rest, the runs are joined into one shift and the yard visit is listed as a mid-shift return.',
      'Only stops at saved Samsara places are listed. Drive time and miles through unsaved stops are added to the next saved stop, and time parked at unsaved places is shown as unsaved stop time. Two stops in a row at the same place under half a mile apart are merged.',
      'Trucks with no driver recorded and yard-to-yard moves with no saved stops are left out. Trucks still out on a shift are not counted until they return.',
      'ELD columns come from the driver’s hours-of-service log: on duty from the end of the last rest of 5 hours or more before the shift until the next one after it. Rest before shift is the length of that earlier rest; "over" means it began before the loaded days. Personal conveyance counts as rest.',
      'Point to point: each saved stop to the next saved stop, including the yard. Average speed is total miles divided by total drive time. "Arrive at From to depart To" is time on site at the first place, plus the drive, plus time on site at the second. With "Direct trips only" on, trips that paused at an unsaved place on the way are left out so averages are not stretched.',
      'Shift hours (ELD): a shift starts when the driver first goes on duty after a rest of 9 hours or more and ends when they go off duty for the next one. Off-duty breaks inside the shift do not end it, and total shift hours is the whole span from first on duty to final off duty. The shift date is the Pacific date the shift started. The yard trip for the same driver is matched as a cross-check. Shifts are flagged for review when there is an off-duty stretch of 4 hours or more inside the shift, the shift starts or ends away from a yard, the driver went on duty after the truck left the yard, or stayed on duty more than an hour after it returned.',
      '80-hour clock: built for California intrastate drivers of flammable-liquid tank vehicles. On-duty time (driving plus on duty, from the ELD log) is added up over the 8 calendar days shown, Pacific time. A rest of 34 hours or more starts a fresh 80, so only time after the latest reset is counted. A work period runs between rests of 10 hours or more; it is counted as over a limit if it has more than 10 hours of driving, or any driving more than 16 hours after it began. Personal conveyance counts as rest. This is a planning aid, not a legal log; the ELD is the record.',
      'Fault history: Samsara records the active fault codes on a truck each time they change. Each row is one stretch where a code stayed active: first seen, last seen, and when it cleared. "Active" means the code was still present in the last reading of the period. Trailers are not included because they do not report engine fault codes.',
      'Flags: over 16 hours yard to yard, over 10 hours of drive time, under 10 hours of rest before the shift, and a 34-hour restart before the shift.'];
    return el('section', { class: 'panel' }, [el('div', { class: 'body' }, [el('ul', { class: 'rules' }, items.map(t => el('li', { text: t })))])]);
  }

  /* ---------- render ---------- */
  function render() {
    document.querySelectorAll('[data-view]').forEach(b => { if (b.dataset.view === st.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('title').textContent = TITLES[st.view]; document.title = TITLES[st.view] + ' | PTI Shift Reports';
    const r = st.report, data = !['check', 'rules'].includes(st.view);
    $('bar').hidden = !data;
    if (st.view === 'eld' || st.view === 'eldday' || st.view === 'tscheck') { const e = st.eld; $('period').textContent = e && !e.example ? 'Shifts that started ' + e.start + ' through ' + e.end + (e.open ? ', ' + e.open + ' driver' + (e.open > 1 ? 's' : '') + ' still on shift and not counted yet' : '') + ', loaded ' + C.fmtDT(e.loadedAt) : ''; }
    else if (st.view === 'hos') { const h = st.hos; $('period').textContent = h && !h.example ? 'The 8 days ending ' + C.fmtDT(h.asOf) + '. Only the To date is used here; set it to today for the current picture.' : ''; }
    else if (st.view === 'faults') { const f = st.faults; $('period').textContent = f && !f.example ? 'Fault codes reported ' + f.start + ' through ' + f.end + ', loaded ' + C.fmtDT(f.loadedAt) + '. Driver and yard filters do not apply here.' : ''; }
    else $('period').textContent = !data ? '' : !r ? 'Loading' : (r.example ? 'Example data' : 'Shifts that started ' + r.start + ' through ' + r.end + (r.inProgress ? ', ' + r.inProgress + ' truck' + (r.inProgress > 1 ? 's' : '') + ' still out and not counted yet' : '') + ', loaded ' + C.fmtDT(r.loadedAt));
    const v = $('view'); v.textContent = ''; v.style.cssText = 'display:flex;flex-direction:column;gap:14px';
    if (st.view === 'check') v.appendChild(checkView());
    else if (st.view === 'rules') v.appendChild(rulesView());
    else if (st.view === 'faults') v.appendChild(faultsView());
    else if (st.view === 'hos') v.appendChild(hosView());
    else if (st.view === 'eld' || st.view === 'eldday') v.appendChild(eldView(st.view));
    else if (st.view === 'tscheck') v.appendChild(tsView());
    else if (!r) v.appendChild(el('section', { class: 'panel' }, [el('div', { class: 'empty', text: st.loading ? 'Loading trips and hours of service from Samsara. A long period can take a minute.' : 'Choose a period and press Run report.' })]));
    else { if (['shifts', 'stops', 'daily', 'totals'].includes(st.view)) v.appendChild(reportBand()); v.appendChild(st.view === 'overview' ? overview() : st.view === 'compare' ? compareView() : tableView(st.view)); }
    const ch = chartsFor(st.view); if (ch) v.appendChild(ch);
  }
  function go(view) { st.view = TITLES[view] ? view : 'overview'; st.q = ''; window.scrollTo(0, 0); if (location.hash.slice(1) !== st.view) history.replaceState(null, '', '#' + st.view); render(); }

  /* ---------- start ---------- */
  document.querySelectorAll('[data-view]').forEach(b => { b.prepend(icon(NAV_ICONS[b.dataset.view])); b.addEventListener('click', () => go(b.dataset.view)); });
  window.addEventListener('hashchange', () => go(location.hash.slice(1)));
  $('preset').addEventListener('change', () => { applyPreset(); if ($('preset').value !== 'custom') load(); });
  ['start', 'end'].forEach(id => $(id).addEventListener('change', () => { $('preset').value = 'custom'; }));
  $('run').addEventListener('click', () => load(true));
  ['f-driver', 'f-truck', 'f-yard', 'f-flag'].forEach(id => $(id).addEventListener('change', render));

  st.view = TITLES[location.hash.slice(1)] ? location.hash.slice(1) : 'overview';
  api('/api/status').then(s => {
    st.status = s; $('dot').className = 'dot' + (s.live ? ' live' : ''); $('mode').textContent = s.live ? 'Live Samsara data' : 'Example data'; $('logout').hidden = !s.signedIn;
    let saved = null; try { saved = JSON.parse(localStorage.getItem('pti.period') || 'null'); } catch (e) { /* optional */ }
    if (saved && saved.preset === 'custom' && saved.start && saved.end) { $('preset').value = 'custom'; $('start').value = saved.start; $('end').value = saved.end; }
    else { if (saved && saved.preset) $('preset').value = saved.preset; applyPreset(); }
    render(); load();
  }).catch(e => { notice('bad', e.message); render(); });
})();
