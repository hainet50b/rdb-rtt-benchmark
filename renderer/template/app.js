'use strict';
// The renderer embeds the measurements, their test configurations, and the text of one language in #report-data.
const REPORT = JSON.parse(document.getElementById('report-data').textContent);

// ===== i18n =====
const L = REPORT.i18n;
// A key with a ".one" variant uses it when vars.n is 1 (for example, "1 row" in English).
const t = (k, vars = {}) => String((vars.n == 1 && L[`${k}.one`]) || (L[k] ?? k)).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? '');
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(el => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  document.querySelectorAll('[data-save]').forEach(el => el.setAttribute('aria-label', t('workload.save', { file: el.dataset.save })));
}

// ===== Common =====
const $ = id => document.getElementById(id);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4'];
const nf = (v, d = 1) => Number(v).toLocaleString(L.locale, { maximumFractionDigits: d, minimumFractionDigits: d });
const int = v => Number(v).toLocaleString(L.locale);
const ms = v => v >= 1000 ? t('unit.s', { v: nf(v / 1000, 2) }) : t('unit.ms', { v: nf(v, v < 10 ? 2 : 1) });
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const q = (a, x) => { const s = [...a].sort((u, v) => u - v); const i = (s.length - 1) * x, lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
const kk = (...a) => a.join('|');

// ===== Data =====
const MEASUREMENT = REPORT.measurement, WORKLOADS = REPORT.workloads, SCENARIOS = REPORT.scenarios;
const ROWS = MEASUREMENT.rows_axis, FETCH = MEASUREMENT.fetch_sizes, DELAYS = MEASUREMENT.delays_ms, REPEATS = MEASUREMENT.repeats;
const DSTEPS = DELAYS.some(x => x > 0) ? DELAYS.filter(x => x > 0) : [...DELAYS];
const W = id => WORKLOADS.find(w => w.id === id);
const workloadLabel = w => w ? w.name : '';
let CONFIG, AGG = new Map();

// results: { workloadId: [[rows, fetchSize, delayMs, elapsedMs, roundtrips], ...] }. A failed measurement has null values.
function aggregate(results) {
  const agg = new Map();
  for (const [workload, list] of Object.entries(results)) for (const [rows, fetch, delay, elapsed, rt] of list) {
    const k = kk(workload, rows, fetch, delay);
    if (!agg.has(k)) agg.set(k, { workload, rows, fetch, delay, runs: [], rts: [], failed: 0 });
    const a = agg.get(k);
    if (elapsed == null) { a.failed++; continue; }
    a.runs.push(elapsed); a.rts.push(rt);
  }
  for (const a of agg.values()) if (a.runs.length) { a.med = q(a.runs, .5); a.p95 = q(a.runs, .95); a.min = Math.min(...a.runs); a.max = Math.max(...a.runs); a.roundtrips = Math.round(q(a.rts, .5)); }
  return agg;
}
const agg = (w, r, f, d) => AGG.get(kk(w, r, f, d));
const val = (w, r, f, d) => agg(w, r, f, d)?.med;
// Points whose value is missing (not measured, or every execution failed) are left out of the lines.
const pts = list => list.filter(pt => pt.y != null && !Number.isNaN(pt.y));

// ===== Charts =====
const charts = {}, DATA = {};
function opts(xTitle, yTitle) {
  const ink2 = css('--ink-2'), grid = css('--grid'), muted = css('--muted');
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'nearest', intersect: false },
    plugins: {
      legend: { labels: { color: ink2, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, font: { family: css('--sans') }, filter: it => !it.text.startsWith('_') } },
      tooltip: { backgroundColor: css('--panel'), titleColor: css('--ink'), bodyColor: ink2, borderColor: css('--line-strong'), borderWidth: 1, padding: 10, cornerRadius: 10, filter: it => !it.dataset.label.startsWith('_m') },
    },
    scales: {
      x: { type: 'linear', ticks: { color: muted }, grid: { color: grid }, border: { color: css('--line-strong') }, title: { display: true, text: xTitle, color: ink2 } },
      y: { ticks: { color: muted }, grid: { color: grid }, border: { display: false }, title: { display: !!yTitle, text: yTitle, color: ink2 } },
    },
  };
}
const draw = (id, conf) => { charts[id]?.destroy(); charts[id] = new Chart($(id), conf); };
const line = (label, data, col, dash) => ({ type: 'line', label, data: pts(data), borderColor: dash ? col + '99' : col, backgroundColor: col, borderWidth: 2, pointRadius: dash ? 2.5 : 4, pointHoverRadius: 6, borderDash: dash ? [5, 4] : [] });
const marker = (x, top) => ({ type: 'line', label: '_marker', data: [{ x, y: 0 }, { x, y: top }], borderColor: css('--accent'), borderDash: [3, 3], borderWidth: 1.5, pointRadius: 0 });
const tipLabel = it => `${it.dataset.label.replace(/^_/, '')}: ${ms(it.parsed.y)}`;
const workloadOptions = current => WORKLOADS.map(w => `<option value="${esc(w.id)}" ${w.id === current ? 'selected' : ''}>${esc(workloadLabel(w))}</option>`).join('');
const maxY = ds => Math.max(0, ...ds.flatMap(s => s.data.map(pt => pt.y)));

// ===== Stepped slider (stops only at measured values; values that are not measured are greyed out) =====
function stepper(el, onChange) {
  const s = { values: [], ok: [], i: 0, disabled: false, fmt: v => v };
  el.setAttribute('role', 'slider');
  const pos = i => s.values.length < 2 ? 0 : i / (s.values.length - 1) * 100;
  const okIdx = () => s.values.map((_, i) => i).filter(i => s.ok[i]);
  s.render = () => {
    const on = !s.disabled;
    el.innerHTML = '<div class="track"></div><div class="fill"></div>' +
      s.values.map((v, i) => `<div class="dot ${!s.ok[i] ? 'na' : on && i <= s.i ? 'on' : ''}" style="left:${pos(i)}%"></div><div class="lbl ${!s.ok[i] ? 'na' : on && i === s.i ? 'cur' : ''}" style="left:${pos(i)}%">${s.fmt(v)}</div>`).join('') +
      '<div class="thumb"></div>';
    el.querySelector('.fill').style.width = `${pos(s.i)}%`;
    el.querySelector('.thumb').style.left = `${pos(s.i)}%`;
    const locked = s.disabled || okIdx().length < 2;
    el.classList.toggle('disabled', s.disabled); el.classList.toggle('locked', locked);
    el.setAttribute('aria-disabled', locked); el.tabIndex = locked ? -1 : 0;
    el.setAttribute('aria-valuetext', s.fmt(s.values[s.i]));
  };
  const nearest = i => okIdx().reduce((b, k) => Math.abs(k - i) < Math.abs(b - i) ? k : b, okIdx()[0] ?? 0);
  s.set = i => { i = nearest(i); if (i === s.i) return; s.i = i; s.render(); onChange(); };
  s.step = dir => { const list = okIdx(), k = list.indexOf(s.i) + dir; if (k >= 0 && k < list.length) s.set(list[k]); };
  s.value = () => s.values[s.i];
  s.config = (values, ok, fmt, initial) => { const want = initial ?? s.values[s.i]; s.values = values; s.ok = values.map(v => ok.includes(v)); if (fmt) s.fmt = fmt; s.i = nearest(Math.max(0, values.indexOf(want))); s.render(); };
  const idxAt = x => { const r = el.getBoundingClientRect(); return Math.round(Math.max(0, Math.min(1, (x - r.left) / r.width)) * (s.values.length - 1)); };
  el.addEventListener('pointerdown', e => { if (el.classList.contains('locked')) return; el.setPointerCapture(e.pointerId); el.classList.add('dragging'); el.focus(); s.set(idxAt(e.clientX)); });
  el.addEventListener('pointermove', e => { if (el.hasPointerCapture(e.pointerId)) s.set(idxAt(e.clientX)); });
  el.addEventListener('pointerup', () => el.classList.remove('dragging'));
  el.addEventListener('keydown', e => { if (el.classList.contains('locked')) return; if (['ArrowRight', 'ArrowUp'].includes(e.key)) { s.step(1); e.preventDefault(); } if (['ArrowLeft', 'ArrowDown'].includes(e.key)) { s.step(-1); e.preventDefault(); } });
  return s;
}
const fmtRows = v => int(v);
const fmtDelay = v => `${v}`;

// ===== 1. Test configuration =====
// Each component can be chosen when the test configurations differ in it.
const ver = v => String(v ?? '').split('+')[0];
const COMPONENTS = [
  ['c-fw', c => `${c.framework.name} (${c.language.name})`, c => `${c.framework.name} ${c.framework.version} (${c.language.name} ${ver(c.language.version)})`],
  ['c-da', c => c.data_access.name, c => `${c.data_access.name} ${c.data_access.version}`],
  ['c-pool', c => c.pool.name, c => `${c.pool.name} ${c.pool.version}`],
  ['c-drv', c => c.driver.name, c => `${c.driver.name} ${c.driver.version}`],
  ['c-db', c => c.database.name, c => `${c.database.name} ${c.database.version}`],
];
function fillConfigSelects() {
  for (const [id, label] of COMPONENTS) {
    const values = [...new Set(REPORT.configurations.map(x => label(x.configuration)))];
    $(id).innerHTML = values.map(v => `<option>${esc(v)}</option>`).join('');
    $(id).disabled = values.length < 2;
    $(id).value = label(REPORT.configurations[0].configuration);
    $(id).addEventListener('change', onConfigChange);
  }
}
const selectedConfig = () => REPORT.configurations.find(x => COMPONENTS.every(([id, label]) => label(x.configuration) === $(id).value));
const versions = c => COMPONENTS.map(([, , full]) => full(c));
function onConfigChange() {
  const config = selectedConfig();
  if (!config) { showRunWarn(t('msg.noCombo')); document.querySelectorAll('.tabpanel').forEach(panel => { panel.hidden = true; }); drawWires(); return; }
  CONFIG = config; AGG = config.agg ??= aggregate(config.results);
  COMPONENTS.forEach(([id], i) => { $(id).title = versions(config.configuration)[i]; });
  const m = MEASUREMENT;
  const all = [...AGG.values()], failed = all.reduce((sum, a) => sum + a.failed, 0);
  const total = all.reduce((sum, a) => sum + a.failed + a.runs.length, 0);
  showRunWarn([
    m.status === 'running' ? t('msg.running') : m.status === 'failed' ? `${t('msg.failed')}: ${m.error ?? ''}` : '',
    failed ? t('msg.partial', { failed: int(failed), total: int(total) }) : '',
  ].filter(Boolean).join('\n'));
  initControls();
  const tab = document.querySelector('.stab[aria-selected="true"]').dataset.tab;
  document.querySelectorAll('.tabpanel').forEach(panel => { panel.hidden = panel.dataset.panel !== tab; });
  renderAll();
}
function showRunWarn(text) { $('run-warn').textContent = text; $('run-warn').hidden = !text; }
function drawWires() {
  const svg = $('wires'), box = $('diagram').getBoundingClientRect();
  if (!box.width) return;
  const rel = el => { const r = el.getBoundingClientRect(); return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top, cx: (r.left + r.right) / 2 - box.left, cy: (r.top + r.bottom) / 2 - box.top }; };
  const c = rel($('conn-busy')), n = rel($('nic')), d = rel($('db-comp'));
  const R = 10, lane = n.cx, sx = c.r + 4, sy = c.cy, endY = d.t - 2;
  const p1 = `M${sx} ${sy} H${lane - R} Q${lane} ${sy} ${lane} ${sy + R} V${n.t - 3}`;
  const p2 = (d.l + 12 < lane && lane < d.r - 12)
    ? `M${lane} ${n.b} V${endY}`
    : `M${lane} ${n.b} V${endY - 16 - R} Q${lane} ${endY - 16} ${lane - R} ${endY - 16} H${d.r - 30 + R} Q${d.r - 30} ${endY - 16} ${d.r - 30} ${endY - 16 + R} V${endY}`;
  svg.setAttribute('viewBox', `0 0 ${box.width} ${box.height}`);
  svg.innerHTML = `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M1 1L9 5L1 9" style="fill:none;stroke:var(--accent);stroke-width:1.6"/></marker></defs>
    <path d="${p1}" marker-end="url(#ah)"/><path d="${p2}" marker-end="url(#ah)"/>`;
}

// ===== 2. Results =====
let axisPref = 'rows', axis = axisPref;
const sRows = stepper($('s-rows'), () => renderResult());
const sDelta = stepper($('s-delta'), () => renderResult());
$('r-workload').addEventListener('change', () => { sRows.config(ROWS, W($('r-workload').value).rows); renderResult(); });
$('r-axis').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; axisPref = b.dataset.v; renderResult(); });
function renderResult() {
  const w = W($('r-workload').value), d = sDelta.value();
  const rowsAxisOk = w.rows.length > 1;
  axis = rowsAxisOk ? axisPref : 'delay';
  $('r-axis').querySelectorAll('button').forEach(b => { b.disabled = b.dataset.v === 'rows' && !rowsAxisOk; b.setAttribute('aria-pressed', b.dataset.v === axis); });
  sRows.disabled = axis === 'rows'; sRows.render();
  const rows = sRows.value();
  $('v-rows').textContent = axis === 'rows' ? t('ctl.onAxis') : t('unit.rows', { n: int(rows) });
  $('v-rows').className = 'val' + (axis === 'rows' ? ' off' : '');
  $('v-delta').textContent = t('unit.ms', { v: d });
  $('r-key').hidden = axis === 'delay';

  const ds = [], onChart = new Set();
  let o;
  if (axis === 'delay') {
    o = opts(t('chart.delta'), t('chart.response'));
    FETCH.forEach((f, i) => { ds.push(line(`fetchSize ${f}`, DELAYS.map(dd => ({ x: dd, y: val(w.id, rows, f, dd) })), css(SERIES[i % SERIES.length]))); DELAYS.forEach(dd => onChart.add(kk(w.id, rows, f, dd))); });
    ds.push(marker(d, maxY(ds)));
  } else {
    o = opts(t('chart.rows'), t('chart.response'));
    o.scales.x.type = o.scales.y.type = 'logarithmic';
    o.scales.x.min = ROWS[0]; o.scales.x.max = ROWS.at(-1);
    FETCH.forEach((f, i) => {
      const col = css(SERIES[i % SERIES.length]);
      ds.push(line(`fetchSize ${f}`, w.rows.map(r => ({ x: r, y: val(w.id, r, f, d) })), col));
      ds.push(line(`_fetchSize ${f}${t('chart.zeroSuffix')}`, w.rows.map(r => ({ x: r, y: val(w.id, r, f, 0) })), col, true));
      w.rows.forEach(r => { onChart.add(kk(w.id, r, f, 0)); onChart.add(kk(w.id, r, f, d)); });
    });
  }
  o.plugins.tooltip.callbacks = { label: tipLabel };
  draw('ch-result', { data: { datasets: ds }, options: o });
  const [framework, dataAccess, pool, driver, database] = versions(CONFIG.configuration);
  DATA.result = { title: t('dlg.resultTitle'), rows: dataRows(w, onChart), context: [
    [t('diagram.framework'), framework], [t('diagram.dataAccess'), dataAccess],
    [t('diagram.pool'), pool], [t('diagram.driver'), driver], [t('diagram.database'), database],
    [t('dlg.repeats'), t('cond.repeatsDesc', { n: REPEATS })],
  ] };
}

// Every condition of every workload in the test configuration. The selected workload comes first, and the rows
// that the chart uses are marked.
function dataRows(selected, onChart) {
  const v = x => x ?? '—';
  return [selected, ...WORKLOADS.filter(w => w !== selected)].flatMap(w => [...AGG.values()]
    .filter(a => a.workload === w.id)
    .sort((a, b) => a.rows - b.rows || a.delay - b.delay || a.fetch - b.fetch)
    .map(a => ({
      [t('ctl.workload')]: workloadLabel(w), [t('col.rows')]: a.rows, [t('col.delta')]: a.delay, [t('col.fetch')]: a.fetch,
      [t('col.succeeded')]: `${a.runs.length} / ${a.runs.length + a.failed}`, [t('col.roundtrips')]: v(a.roundtrips),
      [t('col.median')]: v(a.med), [t('col.p95')]: v(a.p95), [t('col.min')]: v(a.min), [t('col.max')]: v(a.max),
      _failed: a.failed > 0, _onChart: onChart.has(kk(a.workload, a.rows, a.fetch, a.delay)),
    })));
}

// ===== 3. Scenario simulation =====
// A scenario is a named set of queries (workload, rows, count), defined in scenarios/<ID>.yaml.
// A workload with a fixed row count ignores rows.
const ROW_COLORS = ['--row-1', '--row-2', '--row-3', '--row-4', '--row-5'];
const rowColor = i => i < ROW_COLORS.length ? ROW_COLORS[i] : '--muted';
let QUERIES = [], scenarioId = null;
const clone = queries => queries.map(query => ({ ...query }));
const scenarioQueries = id => (SCENARIOS.find(x => x.id === id)?.queries ?? []).map(query => ({ w: String(query.workload), r: W(query.workload)?.rows.length === 1 ? W(query.workload).rows[0] : +query.rows, k: +query.count || 1 }));
function loadScenario(id) { scenarioId = id; QUERIES = clone(scenarioQueries(id)); }
const isDirty = () => scenarioId != null && JSON.stringify(QUERIES) !== JSON.stringify(scenarioQueries(scenarioId));
$('sim-scenario').addEventListener('change', e => { loadScenario(e.target.value); renderSim(); });
$('sim-reset').addEventListener('click', () => { loadScenario(scenarioId); renderSim(); });
const sSim = stepper($('s-simdelta'), () => renderSim());
const sSimRows = stepper($('s-simrows'), () => {});
const queryTime = (query, d, f) => { const v = val(query.w, query.r, f, d); return v == null ? null : query.k * v; };
const measuredQueries = () => QUERIES.filter(query => W(query.w));
const total = (d, f) => measuredQueries().reduce((sum, query) => sum + (queryTime(query, d, f) ?? NaN), 0);
function renderQueryList() {
  $('scenario-queries').innerHTML = QUERIES.map((query, i) => {
    const w = W(query.w);
    const workloadSelect = `<select class="query-workload" data-i="${i}" data-k="w" aria-label="${esc(t('ctl.workload'))}">${w ? '' : `<option selected disabled>${esc(query.w)}</option>`}${workloadOptions(query.w)}</select>`;
    const rowsSel = `<select data-i="${i}" data-k="r" aria-label="${esc(t('ctl.rows'))}" ${!w || w.rows.length < 2 ? 'disabled' : ''}>${ROWS.map(v => `<option value="${v}" ${v === query.r ? 'selected' : ''} ${w?.rows.includes(v) ? '' : 'disabled'}>${esc(t('unit.rows', { n: int(v) }))}</option>`).join('')}</select>`;
    return `<li class="query one">
      <span class="swatch" style="background:var(${rowColor(i)})"></span>
      ${workloadSelect}
      ${rowsSel}
      <div class="count"><button data-i="${i}" data-step="-1" aria-label="${esc(t('query.less'))}">−</button><input type="number" min="1" step="1" value="${query.k}" data-i="${i}" data-k="k" aria-label="${esc(t('query.count'))}"><button data-i="${i}" data-step="1" aria-label="${esc(t('query.more'))}">＋</button></div>
      <button class="x" data-del="${i}" aria-label="${esc(t('query.remove'))}">×</button>
    </li>`;
  }).join('');
  $('sim-dirty').hidden = $('sim-reset').hidden = !isDirty();
  const missing = [...new Set(QUERIES.filter(query => !W(query.w)).map(query => query.w))];
  $('sim-warn').textContent = missing.length ? t('sim.missing', { ids: missing.join(', ') }) : '';
  $('sim-warn').hidden = !missing.length;
}
$('scenario-queries').addEventListener('change', e => {
  const { i, k } = e.target.dataset; if (i === undefined) return;
  const query = QUERIES[+i];
  if (k === 'w') { query.w = e.target.value; const w = W(query.w); if (!w.rows.includes(query.r)) query.r = w.rows.includes(100) ? 100 : w.rows.at(-1); }
  else if (k === 'k') query.k = Math.max(1, Math.round(+e.target.value) || 1);
  else query[k] = +e.target.value;
  renderSim();
});
$('scenario-queries').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.step) { const query = QUERIES[+b.dataset.i]; query.k = Math.max(1, query.k + +b.dataset.step); renderSim(); }
  if (b.dataset.del !== undefined) { QUERIES.splice(+b.dataset.del, 1); renderSim(); }
});
$('query-add').addEventListener('click', () => { const w = WORKLOADS[0]; QUERIES.push({ w: w.id, r: w.rows[0], k: 1 }); renderSim(); });
const queryLabel = query => { const w = W(query.w); return `${w ? workloadLabel(w) : query.w}${w && w.rows.length > 1 ? ` (${t('unit.rows', { n: int(query.r) })})` : ''} × ${query.k}`; };
function renderSim() {
  const d = sSim.value();
  $('v-simdelta').textContent = t('unit.ms', { v: d });
  renderQueryList();
  const ds = FETCH.map((f, i) => line(`fetchSize ${f}`, DELAYS.map(x => ({ x, y: total(x, f) })), css(SERIES[i % SERIES.length])));
  ds.push(marker(d, maxY(ds)));
  const o = opts(t('chart.delta'), t('sim.totalAxis'));
  o.plugins.tooltip.callbacks = { label: tipLabel };
  draw('ch-sim', { data: { datasets: ds }, options: o });
  $('v-share').textContent = `ΔRTT ${t('unit.ms', { v: d })}`;
  const totals = FETCH.map(f => total(d, f));
  const bars = QUERIES.map((query, i) => ({ query, i })).filter(({ query }) => W(query.w)).map(({ query, i }) => ({
    label: queryLabel(query), backgroundColor: css(rowColor(i)), borderColor: css('--panel'), borderWidth: 1.5, borderRadius: 3, barThickness: 22,
    data: FETCH.map((f, j) => (queryTime(query, d, f) ?? NaN) / totals[j] * 100), raw: FETCH.map(f => queryTime(query, d, f)),
  }));
  const ob = opts(t('sim.shareAxis'), '');
  ob.indexAxis = 'y';
  ob.scales.x.stacked = true; ob.scales.x.min = 0; ob.scales.x.max = 100;
  ob.scales.y = { type: 'category', stacked: true, ticks: { color: css('--ink-2') }, grid: { display: false }, border: { display: false } };
  ob.interaction = { mode: 'nearest', intersect: true };
  ob.plugins.legend.labels.pointStyle = 'rectRounded';
  ob.plugins.tooltip.callbacks = { title: () => '', label: it => `${it.dataset.label}: ${ms(it.dataset.raw[it.dataIndex])} (${nf(it.parsed.x, 0)} %)` };
  draw('ch-share', { type: 'bar', data: { labels: FETCH.map((f, j) => [`fetchSize ${f}`, t('sim.sum', { v: Number.isNaN(totals[j]) ? '—' : ms(totals[j]) })]), datasets: bars }, options: ob });
}

// ===== Workloads =====
const KW = /\b(SELECT|FROM|WHERE|ORDER BY|INSERT INTO|VALUES|WITH|AS|UNION ALL|CREATE TABLE|PRIMARY KEY|NOT NULL|NUMBER|VARCHAR2|RPAD|JOIN|ON|AND|OR|IN|GROUP BY)\b/g;
const hl = sql => sql.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(KW, '<span class="kw">$1</span>');
const HEAD_LINES = 10;
function renderWorkloadTab() {
  const w = W($('w-workload').value); if (!w) return;
  const f = w.files;
  $('w-query').innerHTML = hl(f['query.sql'].trimEnd()); $('w-schema').innerHTML = hl(f['schema.sql'].trimEnd());
  const lines = f['data.sql'].trimEnd().split('\n');
  $('w-data').innerHTML = hl(lines.slice(0, HEAD_LINES).join('\n'));
  $('w-data-more').textContent = lines.length > HEAD_LINES ? t('workload.head', { n: HEAD_LINES, total: int(lines.length) }) : t('workload.all', { total: int(lines.length) });
}
$('w-workload').addEventListener('change', renderWorkloadTab);
document.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => {
  const name = b.dataset.save, w = W($('w-workload').value);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([w.files[name]], { type: 'application/sql' }));
  a.download = name; a.click();
}));
$('r-show-workload').addEventListener('click', () => { $('w-workload').value = $('r-workload').value; document.querySelector('.stab[data-tab=workload]').click(); });

// ===== Measurement conditions =====
function renderCond() {
  // Three fetches, each one round trip: ΔRTT wait, outbound, database processing, return.
  $('tr-fetches').innerHTML = [320, 490, 660].map((x, i) => {
    const b = x + 2;
    return `<rect class="sp jd" x="${x}" y="106" width="160" height="26" rx="5"/><text class="st" x="${x + 80}" y="124" text-anchor="middle">fetch ${i + 1}</text>
      <rect class="dl" x="${b}" y="156" width="50" height="26" rx="5"/><text class="st dlt" x="${b + 25}" y="174" text-anchor="middle">ΔRTT</text>
      <rect class="sp net" x="${b + 52}" y="156" width="30" height="26" rx="5"/><text class="st" x="${b + 67}" y="174" text-anchor="middle">${esc(t('range.out'))}</text>
      <rect class="sp db" x="${b + 84}" y="206" width="40" height="26" rx="5"/><text class="st" x="${b + 104}" y="224" text-anchor="middle">${esc(t('range.proc'))}</text>
      <rect class="sp net" x="${b + 126}" y="156" width="30" height="26" rx="5"/><text class="st" x="${b + 141}" y="174" text-anchor="middle">${esc(t('range.back'))}</text>`;
  }).join('') + '<rect class="sp jd" x="826" y="106" width="20" height="26" rx="5"/>';
  const condRows = rows => rows.map(([k, v]) => `<tr><th style="position:static">${esc(k)}</th><td style="white-space:normal">${esc(v)}</td></tr>`).join('');
  $('range-table').innerHTML = condRows([
    [t('range.t'), t('range.tDesc')],
    [t('range.outside'), t('range.outsideDesc')],
    [t('range.n'), t('range.nDesc')],
  ]);
  const m = MEASUREMENT, dp = CONFIG.configuration.database_parameters ?? {};
  $('cond-table').innerHTML = condRows([
    [t('cond.run'), t('cond.runDesc', { id: m.name, at: new Date(m.started_at).toLocaleString(L.locale), end: m.finished_at ? new Date(m.finished_at).toLocaleString(L.locale) : '—' })],
    [t('cond.delay'), MEASUREMENT.delay.method === 'netem' ? t('cond.delayNetem') : t('cond.delayNone')],
    ...(MEASUREMENT.delay.command ? [[t('cond.delayCommand'), MEASUREMENT.delay.command]] : []),
    [t('cond.cache'), t('cond.cacheDesc')],
    ...(dp.result_cache_mode ? [[t('cond.resultCache'), t('cond.resultCacheDesc', { mode: dp.result_cache_mode, size: dp.client_result_cache_size })]] : []),
    [t('cond.repeats'), t('cond.repeatsDesc', { n: REPEATS })],
    [t('cond.warmups'), t('cond.warmupsDesc', { n: MEASUREMENT.warmups })],
    [t('cond.delta'), t('unit.ms', { v: DSTEPS.join(t('list.separator')) })],
  ]);
}

// ===== Model validation =====
const sMRows = stepper($('s-mrows'), () => renderModel());
const sMDelta = stepper($('s-mdelta'), () => renderModel());
const num = v => v == null ? '—' : nf(v, v < 10 ? 2 : 1);
const tm = (w, r, f, d) => { const a = agg(w, r, f, 0); return a?.runs.length ? a.med + a.roundtrips * d : null; };
function renderModel() {
  const r0 = sMRows.value(), d = sMDelta.value();
  $('v-mrows').textContent = t('unit.rows', { n: int(r0) });
  $('v-mdelta').textContent = t('unit.ms', { v: d });
  const rowsOf = w => w.rows.includes(r0) ? r0 : w.rows.reduce((b, v) => Math.abs(v - r0) < Math.abs(b - r0) ? v : b, w.rows[0]);
  $('md-table').innerHTML = `<tr><th>${esc(t('model.colWorkload'))}</th><th class="n">${t('model.colRows')}</th><th class="n">ΔRTT</th><th class="n">fetchSize</th><th class="n">T<sub>0</sub></th><th class="n">n</th><th class="n">T</th><th class="n"><span class="that">T</span></th><th class="n">T ÷ <span class="that">T</span></th></tr>` +
    WORKLOADS.map(w => FETCH.map((f, j) => {
      const r = rowsOf(w), a0 = agg(w.id, r, f, 0), t0 = a0?.med, n = a0?.roundtrips, tt = val(w.id, r, f, d), m = tm(w.id, r, f, d);
      const ratio = tt != null && m ? tt / m : null;
      return `<tr class="${j === 0 ? 'grp' : ''}"><td class="pid">${j === 0 ? esc(workloadLabel(w)) : ''}</td><td class="n ${r !== r0 ? 'fixed' : ''}" title="${r !== r0 ? esc(t('model.fixed')) : ''}">${int(r)}</td><td class="n">${d}</td><td class="n">${f}</td><td class="n">${num(t0)}</td><td class="n">${n == null ? '—' : int(n)}</td><td class="n">${num(tt)}</td><td class="n">${num(m)}</td><td class="n ratio ${ratio == null || Math.abs(ratio - 1) > 0.1 ? 'off' : ''}">${ratio == null ? '—' : nf(ratio, 2)}</td></tr>`;
    }).join('')).join('');
  const all = [...AGG.values()].filter(a => a.delay > 0 && a.runs.length && agg(a.workload, a.rows, a.fetch, 0)?.runs.length);
  const ds = WORKLOADS.map((w, i) => ({ type: 'scatter', label: workloadLabel(w), pointRadius: 3, backgroundColor: css(SERIES[i % SERIES.length]) + 'aa', pointStyle: ['circle', 'rect', 'triangle'][i % 3],
    data: all.filter(a => a.workload === w.id).map(a => ({ x: tm(a.workload, a.rows, a.fetch, a.delay), y: a.med })) }));
  const xs = ds.flatMap(s => s.data.flatMap(pt => [pt.x, pt.y]));
  if (xs.length) {
    const lo = Math.min(...xs) * .8, hi = Math.max(...xs) * 1.2;
    ds.push({ type: 'line', label: t('model.identity'), data: [{ x: lo, y: lo }, { x: hi, y: hi }], borderColor: css('--muted'), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 });
  }
  const o = opts(t('model.xAxis'), t('model.yAxis'));
  o.scales.x.type = o.scales.y.type = 'logarithmic';
  o.plugins.tooltip.callbacks = { label: it => t('model.tip', { label: it.dataset.label, x: ms(it.parsed.x), y: ms(it.parsed.y) }) };
  draw('ch-parity', { data: { datasets: ds }, options: o });
}

// ===== Tabs and dialog =====
document.querySelectorAll('.stab').forEach(tb => tb.addEventListener('click', () => {
  document.querySelectorAll('.stab').forEach(x => x.setAttribute('aria-selected', x === tb));
  document.querySelectorAll('.tabpanel').forEach(panel => { panel.hidden = panel.dataset.panel !== tb.dataset.tab; });
  renderAll();
}));
let current = null;
document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
  current = DATA[b.dataset.open]; if (!current) return;
  $('dlg-title').textContent = current.title;
  $('dlg-ctx').innerHTML = current.context.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  // Keys that start with "_" mark rows and are not shown.
  const cols = Object.keys(current.rows[0] || {}).filter(c => !c.startsWith('_'));
  $('dlg-table').innerHTML = `<tr>${cols.map(c => `<th class="${typeof current.rows[0][c] === 'number' ? 'n' : ''}">${esc(c)}</th>`).join('')}</tr>` +
    current.rows.map(r => `<tr class="${r._failed ? 'has-failure' : ''} ${r._onChart ? 'on-chart' : ''}">${cols.map(c => typeof r[c] === 'number' ? `<td class="n">${Number.isInteger(r[c]) ? int(r[c]) : nf(r[c], 2)}</td>` : `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('');
  $('dlg').showModal();
}));
$('dlg-close').addEventListener('click', () => $('dlg').close());
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });
$('dlg-csv').addEventListener('click', () => {
  // The CSV repeats the context (test configuration, workload, repetitions) on every line, so that one file is self-contained.
  const ctx = current.context.filter(([k]) => !Object.keys(current.rows[0]).includes(k));
  const rows = current.rows.map(r => ({ ...Object.fromEntries(ctx), ...r }));
  const cols = Object.keys(rows[0] || {}).filter(c => !c.startsWith('_'));
  const cell = v => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v;
  const text = [cols.map(cell).join(','), ...rows.map(r => cols.map(c => cell(typeof r[c] === 'number' ? +r[c].toFixed(4) : r[c])).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })); a.download = `${CONFIG.id}.csv`; a.click();
});

// ===== Start =====
function initControls() {
  const resultWorkload = $('r-workload').value, shownWorkload = $('w-workload').value;
  const defaultWorkload = [...WORKLOADS].sort((a, b) => b.rows.length - a.rows.length)[0];
  $('r-workload').innerHTML = workloadOptions(W(resultWorkload) ? resultWorkload : defaultWorkload.id);
  $('w-workload').innerHTML = workloadOptions(W(shownWorkload) ? shownWorkload : WORKLOADS[0].id);
  sRows.config(ROWS, W($('r-workload').value).rows, fmtRows, sRows.values.length ? undefined : 1000);
  sDelta.config(DSTEPS, DSTEPS, fmtDelay, sDelta.values.length ? undefined : 2);
  sSim.config(DSTEPS, DSTEPS, fmtDelay, sSim.values.length ? undefined : 2);
  sSimRows.config(ROWS, ROWS, fmtRows, 1); sSimRows.disabled = true; sSimRows.render();
  sMRows.config(ROWS, ROWS, fmtRows, sMRows.values.length ? undefined : 1000);
  sMDelta.config(DSTEPS, DSTEPS, fmtDelay, sMDelta.values.length ? undefined : 2);
}
function renderAll() {
  if (!CONFIG) return;
  const tab = document.querySelector('.stab[aria-selected="true"]').dataset.tab;
  if (tab === 'result') renderResult(); else if (tab === 'sim') renderSim(); else if (tab === 'model') renderModel(); else if (tab === 'workload') renderWorkloadTab(); else if (tab === 'cond') renderCond();
  drawWires();
}

applyI18n();
$('name-chip').textContent = MEASUREMENT.name; $('name-chip').hidden = false;
$('sim-scenario').innerHTML = SCENARIOS.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
$('sim-scenario').disabled = !SCENARIOS.length;
if (SCENARIOS.length) loadScenario(SCENARIOS[0].id);
fillConfigSelects();
onConfigChange();
new ResizeObserver(drawWires).observe($('diagram'));
document.fonts?.ready.then(drawWires);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
