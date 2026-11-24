/* PTI Shift Reports: page logic. Loads the report once per period, then
   filters, sorts, charts and exports it in the browser. */
(function () {
  const C = Core, $ = id => document.getElementById(id);
  const D = C.fmtDurWords, mi = m => C.miles(m).toFixed(1);
  const st = { report: null, view: 'overview', sort: {}, q: '', loading: false, status: null };
  const TITLES = { overview: 'Overview', shifts: 'Shifts', stops: 'Stops', daily: 'Hours by day', totals: 'Driver totals', check: 'Connection check', rules: 'How numbers are worked out' };

  function el(tag, attrs, kids) {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'class') e.className = attrs[k]; else if (k === 'text') e.textContent = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    for (const c of [].concat(kids || [])) if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return e;
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
  function pills(flags) { return flags.map(f => el('span', { class: 'pill' + (C.isOverLimit(f) ? ' hot' : ''), text: f })); }

  /* ---------- tables: [heading, value, screen format, right-align, CSV format, special] ---------- */
  const hos = (s, f) => (s.hos && !s.hos.none ? f(s.hos) : null);
  const TABLES = {
    shifts: {
      file: 'shifts', rows: () => shifts(), open: r => r, defaultSort: { i: 5, dir: -1 }, cols: [
        ['Shift', s => s.num, null, 1], ['Shift date', s => s.date], ['Driver', s => s.driver], ['Truck', s => s.vehicle],
        ['Start yard', s => s.startYard], ['Departed', s => s.s, C.fmtDT, 1, C.fmtDTcsv], ['End yard', s => s.endYard, null, 0, null, 'csv'], ['Returned', s => s.e, C.fmtDT, 1, C.fmtDTcsv],
        ['Hours worked', s => s.dur, D, 1, C.fmtDur], ['Hours worked (decimal)', s => s.dur, C.hrs, 1, C.hrs, 'csv'], ['Where the time went', s => s.dur, null, 0, null, 'strip'],
        ['Stops', s => s.stops, null, 1], ['Drive time', s => s.drive, D, 1, C.fmtDur], ['Time on site', s => s.onSite, D, 1, C.fmtDur], ['Unsaved stop time', s => s.unlisted + s.yardTime, D, 1, C.fmtDur], ['Miles', s => s.meters, mi, 1, mi],
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
        ['Miles', d => d.meters, mi, 1, mi], ['ELD on-duty time', d => d.hosOnDuty, D, 1, C.fmtDur], ['Shifts over 16h', d => d.over16, null, 1], ['Shifts over 10h driving', d => d.over10, null, 1],
        ['Starts with under 10h rest', d => d.shortRest, null, 1], ['34h restarts', d => d.restarts, null, 1]]
    }
  };
  const ctx = r => (r.l ? r.s : r);
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
    const out = csvText(key), r = st.report;
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
      const tr = el('tr', { class: (r.l && r.l.isReturn ? 'ret ' : '') + (t.open ? 'click' : '') }, t.cols.map(c => {
        if (c[5] === 'csv') return null;
        if (c[5] === 'strip') return el('td', {}, [strip(r, Math.max(STRIP_SCALE, r.dur))]);
        if (c[5] === 'flags') return el('td', {}, pills(show(c, r).split('; ').filter(Boolean)));
        return el('td', { class: c[3] ? 'r' : '', text: show(c, r) });
      }));
      if (t.open) { tr.tabIndex = 0; const go = () => openShift(t.open(r)); tr.addEventListener('click', go); tr.addEventListener('keydown', e => { if (e.key === 'Enter') go(); }); }
      return tr;
    }));
    return el('section', { class: 'panel' }, [
      el('div', { class: 'tools' }, [search, el('span', { class: 'count', text: rows.length.toLocaleString() + (rows.length === 1 ? ' row' : ' rows') + (rows.length > max ? ' (first ' + max.toLocaleString() + ' shown, the CSV has all)' : '') }),
        key === 'shifts' ? legend() : null, el('span', { class: 'grow', style: 'flex:1' }), msg, el('button', { type: 'button', class: 'btn', text: 'Download CSV', onclick: () => downloadCsv(key, msg) })]),
      rows.length ? el('div', { class: 'scroll' }, [el('table', {}, [el('thead', {}, [head]), body])]) : el('div', { class: 'empty', text: st.report ? 'No rows match. Clear the search or filters, or pick another period.' : 'Run a report to see data.' })]);
  }
  function sortBy(key, i) { const so = st.sort[key] || TABLES[key].defaultSort; st.sort[key] = so && so.i === i ? { i, dir: -so.dir } : { i, dir: 1 }; render(); }

  /* ---------- overview ---------- */
  function overview() {
    const S = shifts(), sum = f => S.reduce((a, s) => a + f(s), 0);
    const over = S.filter(s => s.flags.some(C.isOverLimit));
    const tile = (v, label, alert) => el('div', { class: alert ? 'alert' : '' }, [el('b', { text: v }), el('span', { text: label })]);
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
        el('dl', { class: 'facts' }, [].concat(fact('Hours worked', D(s.dur)), fact('Drive time', D(s.drive)), fact('Time on site', D(s.onSite)), fact('Miles', mi(s.meters)), fact('Stops', String(s.stops)), fact('Unsaved stop time', D(s.unlisted + s.yardTime)),
          fact('Rest before shift', h && h.restBefore != null ? (h.restBeforeOpen ? 'over ' : '') + D(h.restBefore) : ''), fact('ELD on-duty time', h ? D(h.onDuty) : ''), fact('ELD driving', h ? D(h.drive) : ''))),
        el('h3', { style: 'margin:0;font:600 15px var(--head)', text: 'Stops in order' }), legs])]);
    $('drawer-root').textContent = '';
    $('drawer-root').appendChild(el('div', { class: 'scrim', onclick: closeDrawer })); $('drawer-root').appendChild(drawer);
    document.addEventListener('keydown', escClose); close.focus();
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
      'Flags: over 16 hours yard to yard, over 10 hours of drive time, under 10 hours of rest before the shift, and a 34-hour restart before the shift.'];
    return el('section', { class: 'panel' }, [el('div', { class: 'body' }, [el('ul', { class: 'rules' }, items.map(t => el('li', { text: t })))])]);
  }

  /* ---------- render ---------- */
  function render() {
    document.querySelectorAll('[data-view]').forEach(b => { if (b.dataset.view === st.view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('title').textContent = TITLES[st.view]; document.title = TITLES[st.view] + ' | PTI Shift Reports';
    const r = st.report, data = !['check', 'rules'].includes(st.view);
    $('bar').hidden = !data;
    $('period').textContent = !data ? '' : !r ? 'Loading' : (r.example ? 'Example data' : 'Shifts that started ' + r.start + ' through ' + r.end + (r.inProgress ? ', ' + r.inProgress + ' truck' + (r.inProgress > 1 ? 's' : '') + ' still out and not counted yet' : '') + ', loaded ' + C.fmtDT(r.loadedAt));
    const v = $('view'); v.textContent = '';
    if (st.view === 'check') v.appendChild(checkView());
    else if (st.view === 'rules') v.appendChild(rulesView());
    else if (!r) v.appendChild(el('section', { class: 'panel' }, [el('div', { class: 'empty', text: st.loading ? 'Loading trips and hours of service from Samsara. A long period can take a minute.' : 'Choose a period and press Run report.' })]));
    else v.appendChild(st.view === 'overview' ? overview() : tableView(st.view));
  }
  function go(view) { st.view = TITLES[view] ? view : 'overview'; st.q = ''; if (location.hash.slice(1) !== st.view) history.replaceState(null, '', '#' + st.view); render(); }

  /* ---------- start ---------- */
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
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
