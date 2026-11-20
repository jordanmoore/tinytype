/* tinytype — renders data/fonts.json and checks which fonts this device has. */
(async function () {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const PLATFORMS = [
    { key: 'ios', label: 'iOS' }, { key: 'android', label: 'Android' },
    { key: 'macos', label: 'macOS' }, { key: 'windows', label: 'Windows' },
  ];
  const DESKTOP = new Set(['macos', 'windows']);
  const SYSTEM_UI = { ios: 'San Francisco', macos: 'San Francisco', android: 'Roboto', windows: 'Segoe UI' };
  const GENERIC_FOR_STYLE = { sans: 'sans-serif', serif: 'serif', mono: 'monospace', handwriting: 'cursive', display: 'sans-serif' };
  const SAMPLE = 'Sphinx of black quartz, judge my vow.';

  let data;
  try {
    const res = await fetch('data/fonts.json');
    if (!res.ok) throw new Error(res.status);
    data = await res.json();
  } catch (e) {
    $('#empty').hidden = false;
    $('#empty').textContent = 'The font data could not be loaded. If this page was opened as a file, serve it over http instead.';
    return;
  }
  const fonts = data.fonts;
  const byName = Object.fromEntries(fonts.map(f => [f.name, f]));
  const scripts = data.scripts || {};

  // ---- Theme switch: follows the system until clicked ---------------------
  const themeBtn = $('#theme');
  themeBtn.addEventListener('click', () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const current = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch (e) { /* private mode */ }
  });

  // ---- Which platform is this? -------------------------------------------
  const here = detectPlatform();
  function detectPlatform() {
    const ua = navigator.userAgent;
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || '';
    if (/iPhone|iPad|iPod/.test(ua) || p === 'iOS') return 'ios';
    if (/Android/.test(ua) || p === 'Android') return 'android';
    if (/Mac/.test(ua) || p === 'macOS') return navigator.maxTouchPoints > 1 ? 'ios' : 'macos';
    if (/Windows/.test(ua) || p === 'Windows') return 'windows';
    return null;
  }
  if (here) {
    const label = PLATFORMS.find(p => p.key === here).label;
    $('#device').innerHTML = `Nothing on this page is a webfont. You are reading it in <b>${SYSTEM_UI[here]}</b>, the interface face of ${label}.`;
    $(`th[data-platform="${here}"]`).classList.add('mine');
  }

  // ---- Is a font on this device? -----------------------------------------
  const ctx = document.createElement('canvas').getContext('2d');
  const baseWidths = {};
  function width(family, text) { ctx.font = `72px ${family}`; return ctx.measureText(text).width; }
  function probe(font) {
    if (font.style === 'emoji') return null; // every platform substitutes its own emoji
    const text = sampleFor(font);
    const q = `"${font.name.replace(/"/g, '')}"`;
    for (const g of ['monospace', 'serif', 'sans-serif']) {
      const k = g + '\u0000' + text;
      if (!(k in baseWidths)) baseWidths[k] = width(g, text);
      if (Math.abs(width(`${q}, ${g}`, text) - baseWidths[k]) > 0.5) return true;
    }
    return false;
  }
  function sampleFor(font) {
    const s = scripts[font.script];
    return (s && s.sample) || font.name;
  }
  function fallbackFor(font) {
    return GENERIC_FOR_STYLE[font.style] || 'sans-serif';
  }
  const quote = f => /^[a-zA-Z-]+$/.test(f) ? f : `"${f}"`;

  // ---- The table ----------------------------------------------------------
  const tbody = $('#rows');
  const rowOf = {};
  for (const f of fonts) {
    const tr = document.createElement('tr');
    tr.dataset.script = f.script || 'latin';
    const label = scripts[f.script] ? scripts[f.script].label : '';
    const latin = !f.script || f.script === 'latin';
    const sample = latin ? f.name : sampleFor(f);
    const metaBits = [];
    if (!latin) metaBits.push(`<span class="nm">${esc(f.name)}</span>`, esc(label));
    if (f.note) metaBits.push(esc(f.note));
    tr.dataset.search = `${f.name} ${label} ${f.style || ''}`.toLowerCase();
    const face = esc(`font-family: ${quote(f.name)}, ${fallbackFor(f)}`);
    let html = `<th scope="row" class="name"><span class="dot" aria-hidden="true"></span>` +
      `<span class="specimen" style="${face}"${latin ? ' lang="en"' : ''}>${esc(sample)}</span>` +
      (metaBits.length ? `<span class="meta">${metaBits.join(' · ')}</span>` : '') + `</th>` +
      `<td class="type">${f.style ? esc(f.style) : ''}</td>`;
    for (const p of PLATFORMS) {
      const cls = 'p' + (DESKTOP.has(p.key) ? ' desktop-col' : '');
      let cell = '';
      if (f[p.key]) cell = `<span class="yes" role="img" aria-label="Yes"></span>`;
      else if (p.key === 'android' && f.androidAlias) cell = `<span class="alias" title="Android maps this name to ${esc(f.androidAlias)}">as ${esc(f.androidAlias)}</span>`;
      else cell = `<span class="visually-hidden">No</span>`;
      html += `<td class="${cls}">${cell}</td>`;
    }
    html += `<td class="here-col"></td>`;
    tr.innerHTML = html;
    tbody.appendChild(tr);
    rowOf[f.name] = tr;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function markHere(name, has) {
    const tr = rowOf[name];
    if (!tr) return;
    const cell = tr.querySelector('.here-col');
    if (has === null) { delete tr.dataset.here; cell.innerHTML = `<span class="visually-hidden">Not checked</span>`; return; }
    tr.dataset.here = has ? 'yes' : 'no';
    cell.innerHTML = has ? `<span class="yes here" role="img" aria-label="On this device"></span>` : `<span class="visually-hidden">Not found</span>`;
  }
  // Probe in slices so the page stays responsive on slow devices.
  let i = 0;
  (function slice() {
    const end = Math.min(i + 40, fonts.length);
    for (; i < end; i++) markHere(fonts[i].name, probe(fonts[i]));
    if (i < fonts.length) requestAnimationFrame(slice);
  })();

  // Chromium can list installed fonts exactly, with permission.
  if ('queryLocalFonts' in window) {
    const btn = $('#exact');
    btn.hidden = false;
    btn.addEventListener('click', async () => {
      try {
        const have = new Set((await window.queryLocalFonts()).map(f => f.family.toLowerCase()));
        for (const f of fonts) markHere(f.name, have.has(f.name.toLowerCase()));
        btn.textContent = 'Checked against your installed fonts';
        btn.disabled = true;
        $('#detect-note').textContent = 'A name shown in colour is installed on this device, according to the browser’s list of local fonts. A faded name is a stand-in.';
      } catch (e) {
        btn.textContent = 'Permission to read fonts was not given';
      }
    });
  }

  // ---- Filters ------------------------------------------------------------
  const q = $('#q'), tScripts = $('#toggle-scripts'), tDesktop = $('#toggle-desktop');
  const params = new URLSearchParams(location.hash.slice(1));
  q.value = params.get('q') || '';

  // Style chips, in a fixed order, only for styles the data actually has.
  const STYLE_ORDER = ['sans', 'serif', 'mono', 'display', 'handwriting', 'symbol', 'emoji'];
  const present = new Set(fonts.map(f => f.style).filter(Boolean));
  const stylesEl = $('#styles');
  let style = present.has(params.get('style')) ? params.get('style') : '';
  for (const key of ['', ...STYLE_ORDER.filter(k => present.has(k))]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.style = key;
    b.textContent = key === '' ? 'All' : key === 'mono' ? 'Mono' : key[0].toUpperCase() + key.slice(1);
    b.addEventListener('click', () => { style = key; apply(); });
    stylesEl.appendChild(b);
  }
  tScripts.checked = params.get('scripts') === 'all';
  // Desktop visitors see all four platforms; phones start with iOS and Android.
  const desktopDefault = !(here === 'ios' || here === 'android');
  tDesktop.checked = params.has('platforms') ? params.get('platforms') === 'all' : desktopDefault;

  function apply() {
    const needle = q.value.trim().toLowerCase();
    const allScripts = tScripts.checked || needle !== '';
    document.body.dataset.platforms = tDesktop.checked ? 'all' : 'mobile';
    let shown = 0;
    for (const f of fonts) {
      const tr = rowOf[f.name];
      const latin = tr.dataset.script === 'latin';
      const ok = (allScripts || latin) && (!style || f.style === style) &&
        (!needle || tr.dataset.search.includes(needle));
      tr.hidden = !ok;
      if (ok) shown++;
    }
    $('#empty').hidden = shown > 0;
    for (const b of stylesEl.children) b.setAttribute('aria-pressed', b.dataset.style === style);
    const p = new URLSearchParams();
    if (needle) p.set('q', q.value.trim());
    if (style) p.set('style', style);
    if (tScripts.checked) p.set('scripts', 'all');
    if (tDesktop.checked !== desktopDefault) p.set('platforms', tDesktop.checked ? 'all' : 'mobile');
    history.replaceState(null, '', p.toString() ? '#' + p.toString() : location.pathname);
  }
  q.addEventListener('input', apply);
  tScripts.addEventListener('change', apply);
  tDesktop.addEventListener('change', apply);
  apply();

  // ---- Stacks -------------------------------------------------------------
  const both = fonts.filter(f => f.ios && f.android).map(f => f.name);
  $('#stacks-intro').textContent = `Only ${both.length} fonts ship on both iOS and Android (${listWords(both)}), ` +
    `so these stacks pair fonts by role instead of by name. Copy one, or build your own below.`;

  function stackValue(lead, names, generic) {
    const parts = [];
    if (lead) parts.push(lead);
    for (const n of names) if (n && !parts.includes(quote(n))) parts.push(quote(n));
    if (generic && !parts.includes(generic)) parts.push(generic);
    return `font-family: ${parts.join(', ')};`;
  }
  function resolves(lead, names, generic) {
    return PLATFORMS.map(p => {
      let got = null, isGeneric = false;
      if (lead === 'system-ui' && SYSTEM_UI[p.key]) got = SYSTEM_UI[p.key];
      for (const n of names) {
        if (got) break;
        const f = byName[n];
        if (!f) continue;
        if (f[p.key]) got = n;
        else if (p.key === 'android' && f.androidAlias) got = f.androidAlias;
      }
      if (!got) { got = generic; isGeneric = true; }
      return `<div><dt>${p.label}</dt><dd class="${isGeneric ? 'generic' : ''}">${esc(got)}</dd></div>`;
    }).join('');
  }
  const list = $('#stack-list');
  for (const s of data.stacks || []) {
    const li = document.createElement('li');
    li.className = 'stack';
    const css = stackValue(s.lead, s.fonts, s.generic);
    li.innerHTML = `<h3>${esc(s.name)}</h3>` +
      `<p class="sample" style="${esc(css)}">${SAMPLE}</p>` +
      `<dl class="resolves">${resolves(s.lead, s.fonts, s.generic)}</dl>` +
      `<div class="code"><code>${esc(css)}</code><button type="button" class="copy">Copy</button></div>` +
      (s.note ? `<p class="note">${esc(s.note)}</p>` : '');
    list.appendChild(li);
  }

  // ---- Builder ------------------------------------------------------------
  const grid = $('#builder-grid');
  const picks = {};
  for (const p of PLATFORMS) {
    const sel = document.createElement('select');
    sel.innerHTML = `<option value="">None</option>`;
    const groups = {};
    for (const f of fonts) {
      if (!f[p.key] || (f.script && f.script !== 'latin')) continue;
      const g = f.style || 'other';
      (groups[g] = groups[g] || []).push(f.name);
    }
    for (const g of ['sans', 'serif', 'mono', 'display', 'handwriting', 'other']) {
      if (!groups[g]) continue;
      const og = document.createElement('optgroup');
      og.label = g === 'mono' ? 'monospace' : g;
      for (const n of groups[g]) og.appendChild(new Option(n, n));
      sel.appendChild(og);
    }
    sel.addEventListener('change', () => { picks[p.key] = sel.value; build(); });
    const lab = document.createElement('label');
    lab.className = 'field';
    lab.innerHTML = `<span>${p.label}</span>`;
    lab.appendChild(sel);
    grid.appendChild(lab);
  }
  const gen = $('#builder-generic'), lead = $('#builder-lead');
  gen.addEventListener('change', build);
  lead.addEventListener('change', build);
  function build() {
    const names = PLATFORMS.map(p => picks[p.key]).filter(Boolean);
    const css = stackValue(lead.checked ? 'system-ui' : '', names, gen.value);
    $('#builder-code').textContent = css;
    $('#builder-sample').style.cssText = css;
  }
  build();

  // ---- Copy buttons -------------------------------------------------------
  document.addEventListener('click', async e => {
    const btn = e.target.closest('.copy');
    if (!btn) return;
    const code = btn.parentElement.querySelector('code');
    try {
      await navigator.clipboard.writeText(code.textContent);
      btn.textContent = 'Copied';
      btn.dataset.done = '';
      setTimeout(() => { btn.textContent = 'Copy'; delete btn.dataset.done; }, 1500);
    } catch (err) {
      const r = document.createRange(); r.selectNodeContents(code);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      btn.textContent = 'Select and copy';
    }
  });

  // ---- Footer -------------------------------------------------------------
  const d = new Date(data.checked + 'T00:00:00');
  $('#checked').textContent = `Lists last checked ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}.`;

  function listWords(a) {
    return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
})();
