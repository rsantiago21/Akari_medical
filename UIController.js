/* Akari · UIController
   Paints every card, dial, the figure, the pulse trace and the Health Index from TelemetryStore + ClinicalEngine.
   No value on screen is hard-coded: everything comes from the store. Also: read-only info popover, compact guided panels,
   notes log, guides, black hole background and the public API window.Akari.
   Code written with AI assistance (see README). */
(function (g) {
  'use strict';
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const S = g.TelemetryStore.init(), E = g.ClinicalEngine, AD = g.SensorAdapters;
  const QS = new URLSearchParams(location.search);
  const MODE = (QS.get('mode') || '').toLowerCase() === 'live' ? 'live' : 'demo';
  /* environment: ?env=leo|lunar|transit|mars. The demo profiles count days in sols, so the demo defaults to Mars */
  E.setEnv((QS.get('env') || (MODE === 'live' ? 'leo' : 'mars')).toLowerCase());
  const PROFILES = g.AKARI_PROFILES || {}, URLP = PROFILES[QS.get('profile')] || PROFILES.p1;
  /* p5 replays a recorded NASA DONKI event (js/donki-event.js, saved from the API, no live call) */
  const DK = URLP && URLP.event === 'donki' && g.AKARI_DONKI ? g.AKARI_DONKI : null;
  if (DK) URLP.base = Object.assign({}, URLP.base, { rate: 0.09 });
  const dkCite = () => DK ? `<div class="why cite">Space weather: ${DK.label}. Geomagnetic storm ${esc(DK.id)}, Kp ${DK.kpMax}, started ${esc(DK.start.replace('T', ' ').replace('Z', ' UTC'))}. Replayed here as a raised dose rate. <a href="${esc(DK.link)}" target="_blank" rel="noopener">NASA DONKI record</a></div>` : '';
  const RM = { matches: false }, TAU = Math.PI * 2;
  const RGB = { nominal: [38, 196, 124], watch: [242, 168, 40], critical: [244, 72, 62], info: [176, 206, 240], off: [150, 160, 175] };
  const WORD = { nominal: 'Normal', watch: 'Watch', critical: 'Act now', off: 'No data' };
  const SRC = { LIVE: 'Live', SIMULATED: '', MANUAL: 'Manual', DISCONNECTED: '' };
  const ico = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function surface(cv, maxR) {
    const o = { cv, c: cv.getContext('2d'), w: 0, h: 0, r: 1, ver: 0 };
    const fit = () => { const w = cv.clientWidth, h = cv.clientHeight, r = Math.min(devicePixelRatio || 1, maxR); if (!w || !h) return; const W = Math.round(w * r), H = Math.round(h * r);
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; } o.w = w; o.h = h; o.r = r; o.ver++; };
    if (g.ResizeObserver) new ResizeObserver(fit).observe(cv); addEventListener('resize', fit); fit(); return o;
  }

  /* ---------- event bus for window.Akari.on ---------- */
  const bus = {};
  const emit = (e, d) => (bus[e] || []).slice().forEach(f => { try { f(d); } catch (err) { console.error('[Akari]', err); } });

  /* ---------- mission clock: demo runs on mission time (the simulator moves it), live on the local clock ---------- */
  const MET0 = ((URLP ? URLP.sol : 142) * 86400 + 7 * 3600 + 31 * 60) * 1000;
  let clock = MODE === 'demo' ? MET0 : Date.now(), clockSet = 0;
  const now = () => (MODE === 'demo' ? clock : Date.now());
  const z2 = n => String(n).padStart(2, '0');
  setInterval(() => { if (MODE === 'demo' && Date.now() - clockSet > 2500) clock += 1000; }, 1000);

  /* ---------- values ---------- */
  function fmt(id, v) {
    if (v == null) return '—';
    switch (id) {
      case 'bp': return v.sys + '/' + v.dia;
      case 'temp': case 'air_co2': return v.toFixed(1);
      case 'radiation': return v.dose.toFixed(1);
      case 'sleep': return E.hm(v.hours);
      default: return String(Math.round(v));
    }
  }
  const unitOf = id => (id === 'sleep' ? '' : S.def(id).unit);

  /* ---------- profile: the only thing the user edits. Saved in this browser, one entry per demo profile ---------- */
  const LIVEP = { name: 'Crew member', role: '', age: '', weight: '', height: '', blood: '', photo: '' };
  const base = () => (MODE === 'live' ? LIVEP : URLP);
  const PK = 'akari.profile.' + (MODE === 'live' ? 'live' : URLP.id);
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(PK) || '{}') || {}; } catch (e) { saved = {}; }
  const keep = () => { try { localStorage.setItem(PK, JSON.stringify(saved)); } catch (e) {} };
  let prof = Object.assign({}, base(), saved);
  const PF = { pName: 'name', pAge: 'age', pRole: 'role', pW: 'weight', pH: 'height', pB: 'blood', pS: 'sex' };
  function renderProf() {
    for (const id in PF) { const el = $('#' + id); if (document.activeElement !== el) el.value = prof[PF[id]] == null ? '' : prof[PF[id]]; }
    const im = $('#pImg'); im.hidden = !prof.photo; if (prof.photo) im.src = prof.photo; $('#photo svg').style.display = prof.photo ? 'none' : '';
    $('.cota').dataset.h = prof.height ? prof.height + ' cm' : '';
    DD.forEach(f => f());
  }
  /* own dropdowns: the native <select> stays hidden as the value holder, the list is drawn by Akari */
  const DD = [];
  $$('#prof select.f').forEach(sel => {
    const w = document.createElement('span'), bt = document.createElement('button'), ul = document.createElement('ul'), opts = [...sel.options];
    w.className = 'dd' + (opts.length > 5 ? ' grid' : ''); bt.type = 'button'; bt.className = 'f'; bt.setAttribute('aria-haspopup', 'listbox');
    bt.setAttribute('aria-label', sel.getAttribute('aria-label') || sel.closest('label').querySelector('.lab').textContent);
    ul.setAttribute('role', 'listbox'); ul.hidden = true;
    ul.innerHTML = opts.map((o, k) => `<li role="option" data-k="${k}">${esc(o.text)}</li>`).join('');
    sel.parentNode.insertBefore(w, sel); w.append(sel, bt, ul); sel.tabIndex = -1;
    let hl = -1;
    const sync = () => { const k = sel.selectedIndex; bt.textContent = k >= 0 ? opts[k].text : '—'; [...ul.children].forEach((li, j) => { li.classList.toggle('on', j === k); li.setAttribute('aria-selected', j === k); li.classList.toggle('hl', j === hl); }); };
    const show = on => { ul.hidden = !on; w.classList.toggle('open', on); bt.setAttribute('aria-expanded', on); if (on) { hl = Math.max(0, sel.selectedIndex); const r = bt.getBoundingClientRect(); w.classList.toggle('up', r.bottom + 220 > innerHeight); } sync(); };
    const pick = k => { sel.selectedIndex = k; sel.dispatchEvent(new Event('input', { bubbles: true })); show(false); bt.focus({ preventScroll: true }); };
    bt.addEventListener('click', e => { e.preventDefault(); show(ul.hidden); });
    ul.addEventListener('click', e => { e.preventDefault(); const li = e.target.closest('li'); if (li) pick(+li.dataset.k); });
    bt.addEventListener('keydown', e => {
      const cols = w.classList.contains('grid') ? 4 : 1, n = opts.length;
      if (ul.hidden) { if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(true); } return; }
      const mv = { ArrowDown: cols, ArrowUp: -cols, ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (mv) { e.preventDefault(); hl = clamp(hl + mv, 0, n - 1); sync(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(hl); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.stopPropagation(); show(false); }
    });
    document.addEventListener('pointerdown', e => { if (!w.contains(e.target)) show(false); });
    DD.push(sync); sync();
  });
  /* own tooltip instead of the browser title bubble */
  {
    const tip = document.createElement('div'); tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
    const take = el => { if (el.hasAttribute('title')) { el.dataset.tip = el.getAttribute('title'); el.removeAttribute('title'); } return el.dataset.tip; };
    document.addEventListener('pointerover', e => { const el = e.target.closest('[title],[data-tip]'); if (!el || e.pointerType === 'touch') { tip.hidden = true; return; } const t = take(el); if (!t) return;
      tip.textContent = t; tip.hidden = false; const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = clamp(r.left + r.width / 2 - w / 2, 8, innerWidth - w - 8) + 'px'; tip.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + 'px'; });
    document.addEventListener('pointerout', e => { const el = e.target.closest('[data-tip]'); if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) tip.hidden = true; });
    addEventListener('scroll', () => { tip.hidden = true; }, true);
  }
  for (const id in PF) $('#' + id).addEventListener('input', e => { const k = PF[id]; prof[k] = e.target.value; saved[k] = e.target.value; keep(); $('.cota').dataset.h = prof.height ? prof.height + ' cm' : ''; });
  $('#pPhoto').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    const im = new Image(), u = URL.createObjectURL(f);
    im.onload = () => { const n = 200, cv = document.createElement('canvas'), k = Math.max(n / im.width, n / im.height); cv.width = cv.height = n;
      cv.getContext('2d').drawImage(im, (n - im.width * k) / 2, (n - im.height * k) / 2, im.width * k, im.height * k); URL.revokeObjectURL(u);
      prof.photo = saved.photo = cv.toDataURL('image/jpeg', .85); keep(); renderProf(); };
    im.src = u; e.target.value = '';
  });
  g.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#pop').hidden) closePop(); });

  /* ---------- cards ---------- */
  const tapAttrs = (id, name) => `data-ch="${id}" data-st="off" role="button" tabindex="0" aria-label="${name}. Tap for details"`;
  const head = d => `<div class="ph"><span class="ico">${ico(d.icon)}</span><span class="lab">${d.name}</span><i class="dot"></i></div>`;
    $('#vit3').innerHTML = ['bp', 'temp', 'radiation'].map(id => { const d = S.def(id);
    return `<div class="m tap" ${tapAttrs(id, d.name)}>${head(d)}<div class="big"><b data-v>—</b><small>${d.unit}</small></div></div>`; }).join('');
  $('#duo').innerHTML = ['spo2', 'air_co2'].map(id => { const d = S.def(id);
    return `<article class="panel sq tap" ${tapAttrs(id, d.name)}>${head(d)}<div class="big"><b data-v>—</b><small>${d.unit}</small></div></article>`; }).join('');
  $('#orbs').innerHTML = ['glucose', 'mood', 'sleep'].map(id => { const d = S.def(id);
    return `<div class="orb" data-k="${id}" ${tapAttrs(id, d.name)}><div class="disc"><svg class="rg" viewBox="0 0 64 64" aria-hidden="true"><circle class="tk" cx="32" cy="32" r="31.4" pathLength="100"/><circle class="tr" cx="32" cy="32" r="28.6"/><circle class="fl" cx="32" cy="32" r="28.6" pathLength="100"/></svg><span class="ico">${ico(d.icon)}</span><b data-v>—</b><small>${d.unit}</small><span class="trend" data-trend></span></div><div class="ph"><span class="lab">${d.name}</span><i class="dot"></i></div><p class="plain" data-t></p></div>`; }).join('');
  S.defs.forEach(d => { if (false && d.band) { const sc = d.scale, b = d.band; $$(`[data-ch=${d.id}] .band`).forEach(el => { el.style.left = (b[0] - sc[0]) / (sc[1] - sc[0]) * 100 + '%'; el.style.width = (b[1] - b[0]) / (sc[1] - sc[0]) * 100 + '%'; }); } });

  /* health index ring: 40 segments plus a fine tick circle */
  {
    const N = 40, r = 44, seg = [];
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * TAU - Math.PI / 2 + 0.03, a1 = ((i + 1) / N) * TAU - Math.PI / 2 - 0.03;
      seg.push(`<path class="seg" d="M${(50 + r * Math.cos(a0)).toFixed(2)} ${(50 + r * Math.sin(a0)).toFixed(2)}A${r} ${r} 0 0 1 ${(50 + r * Math.cos(a1)).toFixed(2)} ${(50 + r * Math.sin(a1)).toFixed(2)}"/>`);
    }
    $('#hiRing').innerHTML = seg.join('') + '<circle class="tk" cx="50" cy="50" r="36" pathLength="160"/><circle class="tk" cx="50" cy="50" r="49.5" pathLength="240"/>';
  }

  /* weight bar and sensor chips */
  $('#wbar').innerHTML = S.defs.map(d => `<i data-ch="${d.id}" style="flex:${d.weight}" title="${d.name} · ${d.weight} %"></i>`).join('');
  $('#chips').innerHTML = S.defs.map(d => `<button type="button" class="chip" data-chip="${d.id}" data-s="DISCONNECTED" title="${d.name}"><i class="dot"></i><span>${d.short}</span><em></em></button>`).join('');

  /* ---------- notes log ---------- */
  const LOG = [];
  let quiet = true;
  function log(text, st) {
    if (quiet) return;
    const t = new Date(now());
    LOG.unshift({ text, st: st || 'info', time: `${z2(t.getUTCHours())}:${z2(t.getUTCMinutes())}` });
    if (LOG.length > 60) LOG.pop();
    paintNotes();
  }

  /* ---------- render ---------- */
  let R = null, lastHead = '', prevRules = new Set(), prevEm = false;
  function recompute() {
    R = E.evaluate(S);
    render();
    const ids = new Set(R.rules.map(r => r.id));
    R.rules.forEach(r => { if (!prevRules.has(r.id)) { log(`${r.title}`, r.level); emit('rule', { rule: r, on: true }); if (!quiet) Dock.auto(r); } });
    prevRules.forEach(id => { if (!ids.has(id)) { log(`Back in range: ${E.RULES.find(x => x.id === id).title.toLowerCase()}`, 'nominal'); emit('rule', { id, on: false }); } });
    prevRules = ids;
    if (R.emergency !== prevEm) { prevEm = R.emergency; emit('emergency', R.emergency); if (R.emergency && !quiet) Dock.auto({ id: 'HYPOXIA_ACUTE', emergency: true }); }
    if (!R.active && Dock.current && Dock.current.em) Dock.close();
    Dock.live();
    emit('update', R);
    if (BC) try { BC.postMessage({ type: 'state', from: 'app', healthIndex: R.healthIndex, confidence: R.confidence, status: Object.fromEntries(S.order.map(id => [id, S.channels[id].status])), rules: R.rules.map(r => r.id) }); } catch (e) {}
  }

  function paintCard(el, id) {
    const c = R.channels[id], ch = S.channels[id];
    el.dataset.st = c.state;
    const v = el.querySelector('[data-v]'); if (v) v.textContent = c.active ? fmt(id, c.value) : '—';
    const t = el.querySelector('[data-t]'); if (t) t.textContent = c.active ? c.text : 'Awaiting sensor';
    const s = el.querySelector('[data-src]'); if (s) { s.textContent = SRC[ch.status]; s.dataset.s = ch.status; s.hidden = !c.active; }
    const sub = el.querySelector('[data-sub]');
    if (sub) {
      let x = '';
      if (id === 'bp') x = R.derived.map != null ? `MAP ${R.derived.map} · Shock index ${R.derived.si != null ? R.derived.si.toFixed(2) : '—'}` : 'Normal 100–130 / 60–85';
      if (id === 'temp') x = `Your usual ${R.limits.temp.base.toFixed(1)} °C · fever from ${R.limits.temp.watch.toFixed(1)}`;
      if (id === 'radiation') x = c.active && c.value.rate != null ? `Rate ${c.value.rate.toFixed(2)} mSv/h · career limit 600` : 'Career limit 600 mSv';
      if (id === 'spo2') x = 'Normal 95–100 %';
      if (id === 'air_co2') x = c.active ? `≈ ${Math.round(c.value * 1316).toLocaleString('en-US')} ppm · NASA limit 3.0 (1 h)` : 'NASA limit 3.0 mmHg (1 h average)';
      sub.textContent = x;
    }
    const mk = el.querySelector('.mk');
    if (mk && c.active) { const d = S.def(id), sc = d.scale, x = id === 'bp' ? c.value.sys : id === 'radiation' ? c.value.dose : c.value; mk.style.left = clamp((x - sc[0]) / (sc[1] - sc[0]), 0, 1) * 100 + '%'; }
    const pl = el.querySelector('polyline');
    if (pl) {
      const hs = ch.history.slice(-30).map(h => (id === 'bp' ? h.value.sys : id === 'radiation' ? h.value.dose : h.value)).filter(Number.isFinite);
      if (hs.length > 1 && c.active) { const a = Math.min(...hs), b = Math.max(...hs), k = b - a || 1; pl.setAttribute('points', hs.map((y, i) => (i / (hs.length - 1) * 100).toFixed(1) + ',' + (21 - (y - a) / k * 18).toFixed(1)).join(' ')); }
      else pl.setAttribute('points', '');
    }
    const fl = el.querySelector('.fl');
    if (fl) { const d = S.def(id), x = !c.active ? 0 : id === 'sleep' ? c.value.hours : c.value; fl.style.strokeDashoffset = 100 - clamp((x - d.ring[0]) / (d.ring[1] - d.ring[0]), 0, 1) * 100; }
    const tr = el.querySelector('[data-trend]');
    if (tr) { const T = id === 'glucose' && c.active ? R.derived.trend : null; tr.textContent = T ? T.arrow : ''; tr.title = T ? `Trend: ${T.word} (${T.rate} mg/dL per min)` : ''; }
  }

  function render() {
    if (!R) return;
    $$('[data-ch]').forEach(el => { if (el.dataset.ch && R.channels[el.dataset.ch] && !el.matches('#wbar i')) paintCard(el, el.dataset.ch); });
    // pulse header
    const hr = R.channels.hr;
    $('#bpm').textContent = hr.active ? Math.round(hr.value) : '—';
    $('#hrText').textContent = hr.active ? (hr.state === 'nominal' ? '' : hr.text) : 'Awaiting sensor';
    // health index + confidence
    const hst = R.healthIndex == null ? 'off' : R.emergency ? 'critical' : R.healthIndex >= 85 ? 'nominal' : R.healthIndex >= 60 ? 'watch' : 'critical';
    $('#hi').dataset.st = hst;
    $('#hiN').textContent = R.healthIndex == null ? '—' : R.healthIndex;
    const on = R.healthIndex == null ? 0 : Math.round(R.healthIndex / 100 * 40);
    $$('#hiRing .seg').forEach((p, i) => p.classList.toggle('on', i < on));
    $('#conf').textContent = R.confidence + ' %';
    $('#confN').textContent = `· ${R.active}/${R.total}`;
    $$('#wbar i').forEach(i => i.classList.toggle('on', R.channels[i.dataset.ch].active));
    $$('[data-chip]').forEach(b => { const id = b.dataset.chip, st = S.channels[id].status; b.dataset.s = st; b.querySelector('em').textContent = st === 'DISCONNECTED' ? 'OFF' : SRC[st].toUpperCase(); b.title = `${S.def(id).name}: ${st === 'DISCONNECTED' ? 'not connected' : 'connected'}`; });
    document.body.classList.toggle('crit', R.emergency);
    $('#avatar').style.setProperty('--tone', R.emergency ? 'var(--critical)' : 'var(--acc)');
    // spoken line
    if (R.headline !== lastHead) {
      lastHead = R.headline;
      say(!R.active ? 'Waiting for sensor data. Nothing is being measured right now.' : R.emergency ? 'Stay calm. I am with you. One step at a time.' : '');
    }
    paintNotes();
    hud();
  }
  /* helmet view: visor overlay with live readouts; the choice is remembered */
  function hud() {
    if (!R || !document.body.classList.contains('helmet')) return;
    $$('#visor [data-hud]').forEach(el => { const id = el.dataset.hud, b = el.querySelector('b');
      if (id === 'hi') { b.textContent = R.healthIndex == null ? '—' : R.healthIndex; el.dataset.st = $('#hi').dataset.st; return; }
      const c = R.channels[id]; b.textContent = c.active ? fmt(id, c.value) + ' ' + unitOf(id) : '—'; el.dataset.st = c.active ? c.state : 'off'; });
    $('#hudClock').textContent = (R.emergency ? 'Alert · ' : 'Suit link · ') + new Date().toTimeString().slice(0, 8);
  }
  function setView(v) {
    const on = v === 'helmet'; document.body.classList.toggle('helmet', on);
    $('#vname').textContent = on ? 'Helmet' : 'Normal'; $('#vbtn').setAttribute('aria-pressed', on);
    try { localStorage.setItem('akari.view', on ? 'helmet' : 'normal'); } catch (_) {}
    hud(); dispatchEvent(new Event('resize'));
  }
  $('#vbtn').addEventListener('click', () => setView(document.body.classList.contains('helmet') ? 'normal' : 'helmet'));
  try { const q = new URLSearchParams(location.search).get('view'); if (q === 'helmet' || (!q && localStorage.getItem('akari.view') === 'helmet')) setTimeout(() => setView('helmet')); } catch (_) {}
  setInterval(hud, 1000);

  function paintNotes() {
    if (!R) return;
    const act = R.items.slice(0, 6).map((it, i) => `<li class="a" data-st="${it.level}" data-item="${i}" tabindex="0"><i class="dot"></i><div><b>${esc(it.title)}</b> <span>${esc(it.text)}</span></div><span class="go">${it.kind === 'channel' ? 'Info ›' : 'Steps ›'}</span></li>`);
    if (!act.length) act.push(`<li data-st="nominal"><i class="dot"></i><div><b>${R.active ? 'All readings in range' : 'No sensors connected'}</b> <span>${R.active ? 'Nothing needs your attention.' : 'Akari is waiting for data from the sensors.'}</span></div><span></span></li>`);
    if (DK) act.push(`<li data-st="watch" class="dk"><i class="dot"></i><div><b>Recorded NASA DONKI event</b> <span>Geomagnetic storm ${esc(DK.id)} (Kp ${DK.kpMax}). Dose rate raised for this replay. <a href="${esc(DK.link)}" target="_blank" rel="noopener">Record</a></span></div><span></span></li>`);
    $('#ev').innerHTML = act.join('') + LOG.slice(0, 14).map(l => `<li class="log"><i class="dot"></i><div>${esc(l.text)}</div><time>${l.time}</time></li>`).join('');
    $('#evN').textContent = R.items.length ? `${R.items.length} active` : '';
  }
  $('#ev').addEventListener('click', e => { const li = e.target.closest('li.a'); if (!li) return; const it = R.items[+li.dataset.item]; if (!it) return;
    if (it.kind === 'channel') openInfo(it.id, $(`[data-ch=${it.id}]`)); else if (it.kind === 'rule') Dock.openRule(it.id); else Dock.open(oneShot(it)); });
  $('#ev').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.click(); });

  /* typed line beside the figure */
  let sayT = '', ci = 0;
  const say = t => { sayT = t; ci = RM.matches ? t.length - 1 : 0; };
  setInterval(() => { if (ci < sayT.length) $('#say').textContent = sayT.slice(0, ++ci); }, 24);

  /* ---------- read-only info popover: what it is, normal range, what to do. Nothing here changes data ---------- */
  const INFO = {
    bp: ['How hard the blood pushes on the artery walls. In weightlessness fluid shifts to the head.', 'Normal 100–130 / 60–85 mmHg · very high from 180/120'],
    hr: ['Heart beats per minute, read from the chest or wrist sensor. It rises during exercise; judge it at rest.', 'Normal at rest 50–100 bpm'],
    glucose: ['Sugar in the blood, the body\'s fuel. The arrow shows where it is heading.', 'In range 70–140 mg/dL · low below 70, serious below 54'],
    spo2: ['How much oxygen the blood carries. It can drop before you feel anything.', 'Normal 95–100 %'],
    mood: ['A one-tap daily check of how you feel, from 1 (very low) to 5 (very good).', 'Good is 4 or 5'],
    sleep: ['Hours slept last night and time awake since.', 'Rested is 7 h or more; awake under 16 h'],
    temp: ['Core body temperature. On long missions it settles up to about 1 °C higher than on Earth, and climbs faster with exercise. Akari learns your usual value and counts fever from there.', () => `Your usual ${R.limits.temp.base.toFixed(1)} °C · fever from ${R.limits.temp.watch.toFixed(1)} °C · act from ${R.limits.temp.crit.toFixed(1)} °C`],
    air_co2: ['Carbon dioxide in the cabin air you breathe. High levels cause headaches and eye strain. Without gravity, exhaled air can pool around the face where air does not move.', () => `Under 2.5 mmHg · NASA limit 3.0 mmHg as a 1 h average${R.limits.co2Avg != null ? ` · last hour ${R.limits.co2Avg.toFixed(1)}` : ''}`],
    radiation: ['Total radiation dose collected during the mission, plus the current rate.', () => `Watch from 100 mSv · career limit 600 mSv · rate alert above ${R.limits.rateWatch.toFixed(2)} mSv/h (${R.env.label})`]
  };
  /* history of one channel: last readings, normal band shaded, min and max on the left */
  function chart(id) {
    const d = S.def(id), H = S.channels[id].history.filter(h => h.source !== 'DISCONNECTED');
    const pick = (h, k) => (id === 'bp' ? h.value[k || 'sys'] : id === 'radiation' ? h.value.dose : id === 'sleep' ? h.value.hours : h.value);
    const A = H.map(h => pick(h)).filter(Number.isFinite);
    if (A.length < 2) return '<p class="note">Not enough readings yet for a history.</p>';
    const B = id === 'bp' ? H.map(h => pick(h, 'dia')).filter(Number.isFinite) : [];
    const all = A.concat(B); let lo = Math.min(...all), hi = Math.max(...all); const pad = (hi - lo) * .15 || Math.max(1, Math.abs(hi) * .02); lo -= pad; hi += pad;
    const W = 300, Hh = 84, X0 = 30, y = v => (Hh - 6 - (v - lo) / (hi - lo) * (Hh - 12)).toFixed(1), x = (i, n) => (X0 + i / (n - 1) * (W - X0 - 4)).toFixed(1);
    const line = (a, cls) => `<polyline class="${cls}" points="${a.map((v, i) => x(i, a.length) + ',' + y(v)).join(' ')}"/>`;
    let band = ''; if (d.band && id !== 'bp') { const t = clamp(+y(Math.min(hi, d.band[1])), 0, Hh), b = clamp(+y(Math.max(lo, d.band[0])), 0, Hh); if (b > t) band = `<rect class="bd" x="${X0}" y="${t}" width="${W - X0 - 4}" height="${(b - t).toFixed(1)}"/>`; }
    const f = v => (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1));
    return `<figure class="hist"><svg viewBox="0 0 ${W} ${Hh}" preserveAspectRatio="none" role="img" aria-label="History of ${d.name}">${band}<line class="gl" x1="${X0}" x2="${W - 4}" y1="${Hh - 1}" y2="${Hh - 1}"/>${B.length ? line(B, 'l2') : ''}${line(A, 'l1')}</svg><span class="ax t">${f(hi)}</span><span class="ax b">${f(lo)}</span><figcaption class="lab">Last ${A.length} readings${id === 'bp' ? ' · systolic and diastolic' : ''}</figcaption></figure>`;
  }
  let popAnchor = null;
  function openInfo(id, anchor) {
    const d = S.def(id), c = S.channels[id], r = R.channels[id], P = $('#pop');
    popAnchor = anchor;
    P.dataset.st = r.state;
    P.innerHTML = `<div class="row"><h3>${d.name}</h3><span class="src" data-s="${c.status}">${c.status === 'DISCONNECTED' ? 'Off' : SRC[c.status]}</span><button type="button" class="x" data-a="x" aria-label="Close">×</button></div>
      <div class="now"><b>${r.active ? fmt(id, r.value) : '—'}</b><small>${r.active ? unitOf(id) : 'no sensor'}</small></div>
      ${chart(id)}
      <dl><dt class="lab">What it is</dt><dd>${INFO[id][0]}</dd><dt class="lab">Normal range</dt><dd>${typeof INFO[id][1] === 'function' ? INFO[id][1]() : INFO[id][1]}</dd><dt class="lab">What to do</dt><dd class="todo">${esc(r.active ? r.text : 'Nothing to do. The sensor is not sending data.')}</dd></dl>`;
    P.hidden = false;
    placePop();
  }
  function placePop() {
    const P = $('#pop'); if (P.hidden || !popAnchor || innerWidth <= 820) return;
    const a = popAnchor.getBoundingClientRect(), w = P.offsetWidth, h = P.offsetHeight;
    let x = clamp(a.left + a.width / 2 - w / 2, 10, innerWidth - w - 10), y = a.bottom + 8;
    if (y + h > innerHeight - 10) y = a.top - h - 8;
    if (y < 10) y = clamp(innerHeight / 2 - h / 2, 10, innerHeight - h - 10);
    P.style.left = x + 'px'; P.style.top = y + 'px';
  }
  function closePop() { $('#pop').hidden = true; if (popAnchor && popAnchor.focus) popAnchor.focus({ preventScroll: true }); popAnchor = null; }
  $('#pop').addEventListener('click', e => { if (e.target.closest('[data-a=x]')) closePop(); });
  document.addEventListener('pointerdown', e => { const P = $('#pop'); if (!P.hidden && !P.contains(e.target) && !e.target.closest('[data-ch],#ev')) closePop(); });
  addEventListener('resize', placePop);
  document.addEventListener('click', e => { const el = e.target.closest('.tap[data-ch],.orb[data-ch]'); if (el) openInfo(el.dataset.ch, el); });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.tap[data-ch],.orb[data-ch]')) { e.preventDefault(); openInfo(e.target.dataset.ch, e.target); } });

  /* ---------- compact guided panel ---------- */
  const stat = (l, b, u, e) => `<div class="stat"><span class="lab">${l}</span><b>${b}${u ? `<small>${u}</small>` : ''}</b>${e ? `<em>${e}</em>` : ''}</div>`;
  const read = ids => `<div class="stats">${ids.map(id => { const c = R.channels[id]; return `<div class="stat" data-st="${c.state}"><span class="lab">${S.def(id).short}</span><b>${c.active ? fmt(id, c.value) : '—'}<small>${c.active ? unitOf(id) : ''}</small></b><em>${esc(c.text)}</em></div>`; }).join('')}</div>`;
  const steps = a => `<ul class="steps">${a.map(s => `<li>${s}</li>`).join('')}</ul>`;
  const ES = [['Stop and hold on', 'Grab the nearest handrail. Do not move between modules.'], ['Put on the oxygen mask', 'Use the nearest emergency oxygen mask. Open the valve fully.'], ['Breathe with me', 'In for 4 seconds, out for 6. I am watching your oxygen.'], ['Wait for your crewmate', 'Your crewmate is on the way with the medical kit. Keep the mask on.']];
  const delay = () => E.env.delay;
  const choice = (h, acts) => ({ h, p: 'You decide. I only act on what you choose.', acts });
  /* recommendations and emergencies: one checklist of short numbered steps, a box to tick each one, then the choices */
  const LIST = (key, level, label, h, p, x, st, acts, em) => ({ key, level, label, em, done: new Set(),
    pages: [{ list: st, h, p, x, acts }, { h: '', p: '', end: 1 }] });
  const ADV = {
    HYPOXIA_ACUTE: () => LIST('HYPOXIA_ACUTE', 'critical', 'Emergency · low oxygen',
      () => (R && !R.emergency ? 'Oxygen is recovering' : 'Low oxygen · do these now'),
      () => (R && !R.emergency ? 'Keep the mask on until oxygen stays above 94 %. The flight surgeon packet has been sent.' : 'Tick each step when it is done. I keep watching your oxygen every second.'),
      () => `<div class="why">Demo: crewmate alerted · medical packet queued for Earth (signal delay ${delay()})</div>`,
      ES, [['cant', 'I cannot do it'], ['finish', 'Close']], true),
    SEPSIS_EARLY: () => LIST('SEPSIS_EARLY', 'critical', 'Recommendation · fever',
      () => { const r = R.rules.find(x => x.id === 'SEPSIS_EARLY'); return r ? r.title : 'Fever with a fast pulse'; }, () => ruleText('SEPSIS_EARLY'), () => read(['temp', 'hr', 'bp']),
      [['Stop and anchor', 'Rest in your sleep station.'], ['Drink 500 mL of water', 'Then keep taking small sips.'], ['Read temperature in 15 min', 'Akari compares it with your own baseline, not with 38 °C.'], ['Still rising or fast pulse?', 'Send the packet to the flight surgeon.']],
      [['send', 'Send to surgeon'], ['crew', 'Call crewmate']]),
    SANS_RISK: () => LIST('SANS_RISK', 'watch', 'Recommendation · eyes and air', 'Stale air and high pressure', () => ruleText('SANS_RISK'), () => read(['air_co2', 'bp']),
      [['Move to fresh air', 'A well-ventilated module, fans on high.'], ['Check the CO₂ sensor', 'Before taking any painkiller.'], ['Wear the thigh cuffs', 'For 30 minutes.'], ['No head-down positions', 'Until the pressure settles.']],
      [['air', 'Raise the airflow'], ['snooze', 'Remind me in 30 min']]),
    METABOLIC_STRESS: () => LIST('METABOLIC_STRESS', 'watch', 'Recommendation · sleep and sugar', 'Short sleep is raising your blood sugar', () => ruleText('METABOLIC_STRESS'), () => read(['sleep', 'glucose']),
      [['No more caffeine today', '6 to 8 h before bed.'], ['Warm dim light from 20:30', 'Under 50 lux, no blue.'], ['Slow carbs at dinner', 'With protein, no simple sugar.'], ['Resistive exercise (ARED)', 'Before tomorrow\'s main meal.'], ['Bed at 21:30', 'Your sleep window opens then.']],
      [['dim', 'Dim lights at 20:30'], ['snooze', 'Remind me in 30 min']]),
    RAD_IMMUNE: () => LIST('RAD_IMMUNE', 'watch', 'Recommendation · radiation', 'Radiation dose with a slight fever', () => ruleText('RAD_IMMUNE'), () => read(['radiation', 'temp']) + dkCite(),
      [['Go to the shielded area', 'Water, food or polyethylene walls. Stay inside.'], ['Drink water and rest', 'Small sips through the hour.'], ['Watch your body', 'Note nausea, tiredness or a rising temperature.'], ['Report your dose', 'Tell the flight surgeon your total.']],
      [['move', 'I am moving now'], ['snooze', 'Remind me in 15 min']])
  };
  const ruleText = id => { const r = R.rules.find(x => x.id === id); return r ? r.text : 'Readings are back in range. You can close this panel.'; };
  const RESULT = { send: ['Demo: sent', 'The flight surgeon receives your readings after the signal delay. Rest meanwhile.'], crew: ['Your crewmate is coming', 'Stay where you are and keep resting.'], air: ['Airflow raised', 'Demo: cabin fans set to high. I will check CO₂ again in 30 minutes.'], dim: ['Scheduled', 'Cabin lights dim at 20:30. Sleep window opens at 21:30.'], move: ['Good', 'Stay in the shielded module until the dose rate drops. I will tell you when.'], snooze: ['Understood', 'I will remind you later.'] };
  /* guides: a menu of situations, then one short step per screen. Steps come from the crew notes (NASA HRP, OCHMO-TB-019). */
  const chv = id => (R && R.channels[id] && R.channels[id].active ? R.channels[id].value : null);
  const bpOf = () => chv('bp') || null;
  const FREE = (key, label, ids, intro, br) => {
    const starts = [], pages = [{ b: 'm', h: 'What is happening?', p: intro, acts: [], x: () => read(ids) + `<div class="opts">${br.map((o, k) => { const m = o.when && o.when(); return `<button type="button" class="opt ${m ? 'pri' : ''}" data-a="go${starts[k]}"><b>${o.t}</b><small>${o.steps.length} steps · ${o.steps.map(s => s[0]).slice(0, 2).join(', ')}…</small>${m ? '<em>Matches your reading</em>' : ''}</button>`; }).join('')}</div>` }];
    br.forEach((o, k) => {
      starts.push(pages.length);
      o.steps.forEach((s, j) => pages.push({ b: k, bt: o.t, s: j + 1, h: s[0], p: s[1], x: s[2], acts: s[3], next: s[4], bk: j ? undefined : 0 }));
      pages.push({ b: k, bt: o.t, h: 'Done', p: o.done, end: 1 });
    });
    return { key, level: 'info', label, free: true, pages };
  };
  const SEND = [['next', 'I am better'], ['send', 'Send to surgeon'], ['crew', 'Call crewmate']];
  const GUIDES = [
    { key: 'daily', t: 'Daily check', make: () => ({ key: 'daily', level: 'info', label: 'Daily check · 3 min', pages: [
      { h: 'Morning check', p: 'Six short steps. I read each value as you go.', x: steps(['Blood pressure and pulse · 1 min', 'Blood sugar · 30 s', 'Oxygen and temperature · 30 s', 'Sleep and mood · 30 s', 'Today\'s habits · 30 s']), next: 'Start' },
      { h: 'Blood pressure and pulse', p: 'Sit anchored, arm at heart level, feet still. Wait one minute.', x: () => read(['bp', 'hr']) },
      { h: 'Blood sugar', p: 'Read it before the meal. Normal is 70 to 99 mg/dL.', x: () => read(['glucose']) },
      { h: 'Oxygen and temperature', p: 'Take three slow deep breaths first. Oxygen should be 95 to 100 %. Temperature is judged against your own usual value.', x: () => read(['spo2', 'temp']) },
      { h: 'Sleep and mood', p: 'Aim for 7 to 9 hours. Note how you feel on the wrist unit.', x: () => read(['sleep', 'mood']) },
      { h: 'Today\'s habits', p: 'Three things that keep the numbers healthy.', x: steps(['2 to 2.5 h of exercise: bike (CEVIS) or treadmill (T2), alternating with resistive (ARED)', 'Eat one meal with the crew', 'Drink water through the day']) },
      { h: 'Check complete', p: 'Everything is recorded. I keep watching.', end: 1 }] }) },
    { key: 'bp', t: 'Blood pressure', make: () => FREE('bp', 'Guide · blood pressure', ['bp', 'hr'], 'Normal is about 106 mmHg mean pressure. Pick what fits.', [
      { t: 'Low pressure (about 85/55)', when: () => { const b = bpOf(); return b && (b.sys < 90 || b.dia < 60); }, steps: [
        ['Lie down', 'Stop work. Anchor yourself and lie down, raising your legs above your heart.'],
        ['Salt and caffeine', 'Drink 500 mL of water with something salty, or a caffeinated drink.'],
        ['Check again', 'Wait 10 minutes lying still, then read it.', () => read(['bp', 'hr'])],
        ['Still low or dizzy?', 'If it stays low or you feel faint after 15 minutes, ask for help.', null, SEND]], done: 'Rest for 30 minutes before you stand up and move between modules.' },
      { t: 'High pressure (about 137/88)', when: () => { const b = bpOf(); return b && (b.sys >= 130 || b.dia >= 85); }, steps: [
        ['Sit and anchor', 'Stop effort. Sit with your back supported.'],
        ['Breathe slowly', 'In for 4 seconds, out for 6. Keep going for 2 minutes.'],
        ['Check the air', 'Stale air raises pressure. Cabin CO₂ should stay under 2.0 mmHg.', () => read(['air_co2', 'bp'])],
        ['Check again', 'Wait 10 minutes, then read it.', () => read(['bp', 'hr']), SEND]], done: 'Avoid coffee and salty food for the rest of the day.' },
      { t: 'Swelling or pain in neck or leg', steps: [
        ['Do not rub the area', 'Leave it still. Rubbing can move a clot. Note which side and how big it is.'],
        ['Tell the flight surgeon now', 'One-sided swelling, pain or redness in the neck or leg can be a clot, which microgravity makes more likely. It needs an ultrasound check.', null, SEND],
        ['Stay calm and wait', 'Do not exercise that limb until the surgeon answers.']], done: 'Your crewmate and Earth have the details.' },
      { t: 'Before landing or re-entry', steps: [
        ['Salt and fluids', 'Follow the fluid loading protocol your flight surgeon gave you before landing or re-entry.'],
        ['Why', 'Plasma volume drops in orbit. Fluid and salt help you stay upright when gravity returns.']], done: 'Keep up the daily exercise: it protects your circulation.' }]) },
    { key: 'pulse', t: 'Pulse', make: () => FREE('pulse', 'Guide · pulse', ['hr', 'spo2'], 'Resting pulse is usually 50 to 100 bpm, lower if you are very fit. Pick what fits.', [
      { t: 'Fast pulse (above 110)', when: () => chv('hr') > 110, steps: [
        ['Stop and anchor', 'Stop effort. Sit anchored and relaxed.'],
        ['Check your breathing', 'Do you lack air? Look at oxygen and cabin CO₂.', () => read(['spo2', 'air_co2'])],
        ['Check again', 'Wait 10 minutes, then read it.', () => read(['hr']), SEND]], done: 'Avoid coffee until it settles.' },
      { t: 'Slow pulse (below 45)', when: () => chv('hr') != null && chv('hr') < 45, steps: [
        ['Sit anchored now', 'A very slow pulse can make you faint. Do not move between modules.'],
        ['Does it persist?', 'Read again after 2 minutes.', () => read(['hr', 'bp'])],
        ['Tell someone', 'Fainting is the risk. Any medicine is only for the flight surgeon to order.', null, SEND]], done: 'Stay with your crewmate until the surgeon replies.' },
      { t: 'Irregular beat', steps: [
        ['It is common early', 'Sudden, chaotic beats are common in the first 3 days after arriving in space.'],
        ['Remove stimulants', 'No coffee or energy drinks. Rest.'],
        ['Breathe slowly', 'Six breaths a minute, for 3 minutes.', () => read(['hr'])],
        ['If it persists', 'Chest pain, faintness or more than 15 minutes of irregular beat needs the surgeon.', null, SEND]], done: 'Note when it started. It helps the surgeon.' },
      { t: 'Protect your heart every day', steps: [
        ['Exercise 2 to 2.5 h a day', 'Alternate aerobic work (bike CEVIS, or treadmill T2 with harness) with heavy resistive work (ARED).'],
        ['Why', 'It keeps your heart output and the tone of your blood vessels.']], done: 'Daily exercise is your best defence.' }]) },
    { key: 'glucose', t: 'Blood sugar', make: () => FREE('glucose', 'Guide · blood sugar', ['glucose'], 'Normal is 70 to 99 mg/dL. Pick what fits.', [
      { t: 'Low sugar (below 70)', when: () => chv('glucose') != null && chv('glucose') < 70, steps: [
        ['Fast sugar', 'Take 15 g of quick sugar: juice, glucose tablets or a sweet.'],
        ['Rest', 'Stop work. Rest for 15 minutes.'],
        ['Check again', 'Read it after 15 minutes. Still under 70: take another 15 g. Under 54, confused or drowsy: your crewmate uses the medical kit.', () => read(['glucose']), SEND]], done: 'Eat a proper meal with slow carbohydrates afterwards.' },
      { t: 'High sugar (above 180)', when: () => chv('glucose') >= 180, steps: [
        ['No sugar', 'Do not eat or drink anything sweet now.'],
        ['Drink water', 'Drink 300 to 500 mL of water.'],
        ['Check again', 'Read it after 30 minutes.', () => read(['glucose']), SEND]], done: 'A light resistive session helps muscles take up sugar.' },
      { t: 'Eating plan', steps: [
        ['Balance the plate', 'About 50 to 55 % slow carbohydrates, 15 to 20 % high-quality protein, 25 to 30 % healthy fats. Avoid sugar spikes.'],
        ['Time the exercise', 'Do resistive exercise (ARED) before the main meals: muscles take up sugar without insulin.'],
        ['Hydrate', 'Drink steadily through the day. It prevents sugar peaks.']], done: 'Simple habits keep the line flat.' }]) },
    { key: 'oxygen', t: 'Oxygen and suit', make: () => FREE('oxygen', 'Guide · oxygen and suit', ['spo2', 'air_co2'], 'Oxygen should read 95 to 100 %. Pick what fits.', [
      { t: 'Oxygen below 94 %', when: () => chv('spo2') != null && chv('spo2') < 94, steps: [
        ['Stop and breathe deeply', 'Stop work and anchor. Take deep slow breaths. In microgravity warm air does not rise, so exhaled CO₂ can pool around your face.'],
        ['Face the airflow', 'Turn your face toward a vent so fresh air reaches you.', () => read(['spo2', 'air_co2'])],
        ['Below 90 %?', 'If it is under 90 %, put on the nearest emergency oxygen mask now. Open the valve fully.', () => read(['spo2', 'hr'])],
        ['Ask for help', 'Your crewmate brings the medical kit.', null, SEND]], done: 'Keep the mask on until oxygen is back above 94 %.' },
      { t: 'Before a spacewalk (pre-breathe)', steps: [
        ['Why', 'The suit (EMU, Extravehicular Mobility Unit) runs at about 4.3 psi of pure oxygen, a third of cabin pressure. Nitrogen in your tissues must go first or it forms bubbles.'],
        ['Breathe pure oxygen', 'Breathe 100 % oxygen on the mask and do light exercise to flush the nitrogen.'],
        ['Check your oxygen', 'Look at your reading before you leave the airlock.', () => read(['spo2'])]], done: 'Follow the pre-breathe time of your EVA plan.' },
      { t: 'Oxygen drops during a spacewalk', steps: [
        ['Check the suit', 'Oxygen under 94 %: check suit pressure and the oxygen supply at once.'],
        ['Look for water', 'Look for water or condensation in the helmet.'],
        ['Report', 'Tell the crew inside and ground control (Earth link through the Deep Space Network, DSN).', null, SEND]], done: 'Head back to the airlock if told to.' },
      { t: 'Water in the helmet', steps: [
        ['Report at once', 'Tell the crew inside and ground control right now. Do not wait.'],
        ['Protect your breathing', 'Water sticks to the face in microgravity. Move your head to keep your nose and mouth clear. Do not open the helmet.'],
        ['Return to the airlock', 'Take the shortest route back along your safety tether. Your crewmate guides you.', () => read(['spo2'])]], done: 'Stay with the crew until the suit is checked.' }]) },
    { key: 'radiation', t: 'Radiation', make: () => FREE('radiation', 'Guide · radiation', ['radiation', 'temp'], 'Pick what fits.', [
      { t: 'Radiation alert or solar storm', when: () => R && R.channels.radiation.active && R.channels.radiation.state !== 'nominal', steps: [
        ['Stop outside work', 'Cancel any spacewalk preparation and come inside.'],
        ['Go to the shielded area', 'Hydrogen-rich walls (water, food stores, polyethylene) block most solar particles. On the surface, use the storm shelter.'],
        ['Reduce exposure', 'Stay inside until Earth clears the alert.', () => read(['radiation'])],
        ['Watch your body', 'Note nausea, tiredness or a rising temperature.', () => read(['radiation', 'temp']), SEND]], done: 'Akari keeps logging your dose.' },
      { t: 'Protect yourself every day', steps: [
        ['Time is dose', 'Spend sleep and free time in the most shielded area. Keep time near thin walls and outside short.'],
        ['Eat well', 'A balanced diet with fruit and vegetables. No pill is proven to protect against space radiation.'],
        ['Sleep well', 'Good sleep helps cells repair.']], done: 'Small daily habits lower the cost of every dose.' }]) },
    { key: 'temp', t: 'Temperature', make: () => FREE('temp', 'Guide · temperature', ['temp', 'hr'], 'In long missions your normal runs up to 1 °C higher. Akari counts fever from your own value. Pick what fits.', [
      { t: 'Fever', when: () => R && R.channels.temp.active && R.channels.temp.dir === 'hi', steps: [
        ['Rest first', 'Stop work and anchor in your sleep station.'],
        ['Rule out exercise', 'In space, temperature climbs faster with effort and stays up longer. If you trained in the last 30 minutes, rest and read again before deciding it is fever.'],
        ['Drink water', 'Half a litre now, then small sips.'],
        ['Check again', 'Read your temperature in 15 minutes.', () => read(['temp', 'hr'])],
        ['Ask for help', 'If it keeps rising or the pulse is fast, send the packet.', null, SEND]], done: 'Keep drinking and resting.' },
      { t: 'Overheating while training or on a spacewalk', when: () => chv('temp') != null && chv('temp') >= 39, steps: [
        ['Stop the effort', 'At 40 °C or more, or with confusion or headache, stop now and call your crewmate.'],
        ['Raise the cooling early', 'Increase the cold-water flow of the liquid cooling garment (LCVG) before the peak of effort.'],
        ['Fans and towel', 'Aim a fan at the ARED or T2 area and dry the sweat with an absorbent towel.'],
        ['Check the temperature', 'Rest if it keeps climbing.', () => read(['temp'])]], done: 'Cool before you overheat, not after.' },
      { t: 'Before hard exercise', steps: [
        ['Pre-hydrate', 'Drink 400 to 500 mL of cool water 30 minutes before.'],
        ['Why', 'It keeps blood flowing to the skin, which cools you.']], done: 'Good to go.' }]) },
    { key: 'air', t: 'Cabin air', make: () => FREE('air', 'Guide · cabin air', ['air_co2', 'spo2'], 'Cabin CO₂ above 2.0 mmHg can cause headaches. Pick what fits.', [
      { t: 'Headache or drowsy', when: () => chv('air_co2') >= 2, steps: [
        ['Think air first', 'In space a front headache is first treated as local CO₂ build-up.'],
        ['Move to fresh air', 'Go to a well-ventilated module. Set fans to high.'],
        ['Check the sensor', 'Check the cabin air reading before any painkiller.', () => read(['air_co2', 'spo2'])],
        ['Ask for help', 'If it does not fade in 20 minutes, ask for help.', null, SEND]], done: 'Avoid the module where it happened until airflow is fixed.' },
      { t: 'Where to work and sleep', steps: [
        ['Never next to a blocked vent', 'Do not work or sleep where air diffusers are blocked. CO₂ pockets form there.'],
        ['Clear the diffusers', 'Remove bags or cloth in front of them.']], done: 'Moving air is safe air.' },
      { t: 'Filters and sampling', steps: [
        ['Scrubber and filters', 'Follow the schedule: CO₂ scrubber beds (CDRA), HEPA filters and charcoal filters for vapours.'],
        ['Sampling', 'Do the air and water microbe sampling on schedule.']], done: 'Maintenance done.' }]) },
    { key: 'sleep', t: 'Sleep and mood', make: () => FREE('sleep', 'Guide · sleep and mood', ['sleep', 'mood'], 'Aim for 7 to 9 hours of sleep. Pick what fits.', [
      { t: 'Sleep tonight', when: () => chv('sleep') && chv('sleep').hours < 6, steps: [
        ['No stimulants', 'No caffeine for 6 to 8 hours before bed.'],
        ['Warm dim light', 'Two hours before bed, switch to warm dim light under 50 lux with no blue.'],
        ['Same schedule', 'Go to bed at the same time as yesterday.'],
        ['Sleep aids', 'Any sleep medicine only as prescribed by the flight surgeon.']], done: 'In the morning use bright blue-rich white light (about 480 nm) to wake up.' },
      { t: 'Low mood or stress', when: () => chv('mood') != null && chv('mood') <= 2, steps: [
        ['Pause', 'Take a short break with controlled breathing: in 4 s, out 6 s, for 2 minutes.'],
        ['Log how you feel', 'Note it on the wrist unit.', () => read(['mood'])],
        ['Be with someone', 'Share a meal with the crew. Use your free time for music, reading or photography.'],
        ['Conflicts', 'If tension with a crewmate is the cause, use the agreed conflict steps, or tell the surgeon.', null, SEND]], done: 'Free time is protected. Use it.' }]) }
  ];
  $('#gl').innerHTML = GUIDES.map(gd => `<button type="button" data-guide="${gd.key}">${gd.t}</button>`).join('');
  $('#gl').addEventListener('click', e => { const b = e.target.closest('[data-guide]'); if (b) Dock.openGuide(b.dataset.guide); });
  const oneShot = it => ({ key: 'one-' + it.id, level: it.level, label: it.level === 'critical' ? 'Needs attention' : 'Worth a look', pages: [{ h: it.title, p: it.text, end: 1 }] });

  const Dock = (() => {
    let cur = null, i = 0, min = false, dismissed = new Set();
    const el = $('#dock'), pill = $('#mini');
    const val = x => (typeof x === 'function' ? x() : x || '');
    function draw(focus) {
      if (!cur) { el.hidden = true; drawPill(); return; }
      const pg = cur.pages[i], n = cur.pages.length;
      el.dataset.st = cur.level === 'info' ? 'info' : cur.level;
      el.classList.toggle('em', !!cur.em);
      const acts = pg.acts || [[pg.end ? 'finish' : 'next', pg.end ? 'Done' : pg.next || 'Next']];
      const big = !!(cur.free || cur.key === 'daily');
      el.classList.toggle('big', big);
      let rail = '', sn = '';
      if (big) {
        const L = cur.pages.map((q, k) => [q, k]).filter(([q]) => !q.end && (cur.free ? q.b === pg.b : true) && (!cur.free || pg.b !== 'm'));
        const pos = L.findIndex(([, k]) => k === i);
        if (pg.b === 'm') rail = `<div class="rail"><span class="lab">How it works</span><ol><li class="now"><span>1</span>Pick what fits</li><li><span>2</span>Follow one step per screen</li><li><span>3</span>Ask for help if it does not improve</li></ol></div>`;
        else rail = `<div class="rail"><span class="lab">${esc(pg.bt || cur.label.replace(/ · .*/, ''))}</span><ol>${L.map(([q, k], n) => `<li class="${pg.end || k < i ? 'ok' : k === i ? 'now' : ''}"><span>${pg.end || k < i ? '✓' : n + 1}</span>${esc(val(q.h))}</li>`).join('')}</ol></div>`;
        sn = pg.end ? '<div class="sn ok">All steps done</div>' : pos >= 0 && pg.b !== 'm' ? `<div class="sn">Step <b>${pos + 1}</b> of ${L.length}</div>` : '';
      }
      if (pg.list) {
        const D = cur.done, m = pg.list.length, d = D.size;
        el.innerHTML = `<header><i class="dot"></i><span class="lab">${cur.label}</span><span class="dv" data-dv></span><button type="button" class="x" data-a="min" title="Minimise" aria-label="Minimise">–</button><button type="button" class="btn sm" data-a="exit">Exit</button></header>
        <div class="body"><h2>${esc(val(pg.h))}</h2>${pg.alt ? `<p class="done">${esc(pg.alt)}</p>` : `<p>${esc(val(pg.p))}</p>`}${val(pg.x)}<ol class="chk">${pg.list.map((s, j) => `<li><button type="button" data-a="chk" data-k="${j}" class="${D.has(j) ? 'ok' : ''}" aria-pressed="${D.has(j)}"><span class="n">${j + 1}</span><span class="bx">${D.has(j) ? '✓' : ''}</span><span><b>${esc(s[0])}</b>${s[1] ? `<small>${esc(s[1])}</small>` : ''}</span></button></li>`).join('')}</ol>${d === m ? `<p class="done">All ${m} steps done.${cur.em ? ' Stay with your crewmate.' : ''}</p>` : ''}</div>
        <footer><span class="cnt ${d === m ? 'all' : ''}">${d} of ${m} done</span><div class="acts">${acts.map(([k, t], j) => `<button type="button" class="btn sm ${j ? '' : 'pri'}" data-a="${k}">${t}</button>`).join('')}</div></footer>`;
        el.hidden = min; live(); drawPill();
        if (focus && !min) { const b = el.querySelector('.chk button:not(.ok)') || el.querySelector('.acts .btn'); if (b) b.focus({ preventScroll: true }); }
        return;
      }
      el.innerHTML = `<header><i class="dot"></i><span class="lab">${cur.label} · ${pg.end ? 'done' : `${cur.free ? (pg.b === 'm' ? 'choose' : 'step ' + pg.s) : `step ${i + 1} of ${n - (cur.pages[n - 1].end ? 1 : 0)}`}`}</span><span class="dv" data-dv></span><button type="button" class="x" data-a="min" title="Minimise" aria-label="Minimise">–</button><button type="button" class="btn sm" data-a="exit">Exit</button></header>
        ${rail}<div class="body">${sn}<h2>${esc(val(pg.alt ? '' : pg.h) || val(pg.h))}</h2><p>${esc(val(pg.alt || pg.p))}</p>${val(pg.x)}</div>
        <footer><button type="button" class="btn sm" data-a="back" ${!i || pg.end ? 'hidden' : ''}>Back</button><div class="prog">${cur.pages.map((q, k) => [q, k]).filter(([q]) => !cur.free || q.b === pg.b).map(([, k]) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div><div class="acts">${acts.map(([k, t], j) => `<button type="button" class="btn sm ${j ? '' : 'pri'}" data-a="${k}">${t}</button>`).join('')}</div></footer>`;
      el.hidden = min; live(); drawPill();
      if (focus && !min) { const b = el.querySelector('.acts .btn'); if (b) b.focus({ preventScroll: true }); }
    }
    /* desktop: over the notes box and the row below it, so pulse, figure and the vitals stay visible */
    function place() {
      for (const x of [el, pill]) { x.style.left = x.style.top = x.style.width = x.style.maxHeight = x.style.bottom = ''; }
      if (innerWidth <= 820) return;
      if (el.classList.contains('big') && !el.hidden) return;
      const a = $('.events').getBoundingClientRect(), b = $('.c2').getBoundingClientRect();
      el.style.left = a.left + 'px'; el.style.top = a.top + 'px'; el.style.width = a.width + 'px'; el.style.maxHeight = (b.bottom - a.top) + 'px'; el.style.bottom = 'auto';
      pill.style.left = a.left + 'px'; pill.style.top = (a.top + 4) + 'px'; pill.style.bottom = 'auto';
    }
    addEventListener('resize', () => { if (cur || !pill.hidden) place(); });
    function drawPill() {
      place();
      const emOpen = R && R.emergency && (!cur || !cur.em);
      const show = (cur && min) || emOpen;
      pill.hidden = !show;
      if (!show) return;
      const c = cur && min ? cur : null;
      pill.dataset.st = c ? (c.level === 'info' ? 'info' : c.level) : 'critical';
      pill.classList.toggle('em', c ? !!c.em : true);
      pill.innerHTML = `<i class="dot"></i>${c ? `${c.label} · ${c.done ? `${c.done.size}/${c.pages[0].list.length}` : `${i + 1}/${c.pages.length}`}` : 'Emergency · open the steps'} ›`;
    }
    function live() {
      const dv = el.querySelector('[data-dv]');
      if (dv && cur && cur.em && R) { const h = R.channels.hr, o = R.channels.spo2; dv.innerHTML = `<span>Pulse <b>${h.active ? Math.round(h.value) : '—'}</b></span><span>O₂ <b>${o.active ? Math.round(o.value) : '—'}</b> %</span>`; }
      if (cur && cur.em && R && cur.lastEm !== R.emergency) { const first = cur.lastEm === undefined; cur.lastEm = R.emergency; if (!first) { draw(); return; } }
      drawPill();
    }
    function open(item, focus = true) { cur = item; i = 0; min = false; draw(focus); }
    function close() { if (cur) dismissed.add(cur.key); cur = null; min = false; draw(); }
    pill.onclick = () => { if (cur && min) { min = false; draw(true); } else if (R && R.emergency) open(ADV.HYPOXIA_ACUTE()); };
    el.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || !cur) return;
      const a = b.dataset.a, last = cur.pages[cur.pages.length - 1];
      if (a === 'chk') { const k = +b.dataset.k; cur.done.has(k) ? cur.done.delete(k) : cur.done.add(k); draw(); const nb = el.querySelector(`[data-k="${k}"]`); if (nb) nb.focus({ preventScroll: true }); return; }
      if (a === 'min') { min = true; draw(); }
      if (a === 'exit' || a === 'finish') close();
      if (a === 'back') { const q = cur.pages[i]; i = q.bk != null ? q.bk : Math.max(0, i - 1); draw(true); }
      if (/^go\d+$/.test(a)) { i = +a.slice(2); draw(true); }
      if (a === 'next') { i = Math.min(cur.pages.length - 1, i + 1); draw(true); }
      if (a === 'cant') { cur.pages[i].alt = 'Demo: understood. Your crewmate has been told you need hands-on help. Stay where you are.'; draw(true); log('Crewmate asked for hands-on help', 'critical'); }
      if (RESULT[a]) { last.h = RESULT[a][0]; last.p = a === 'send' ? `The flight surgeon receives your readings in ${delay()}. Rest meanwhile.` : RESULT[a][1]; i = cur.pages.length - 1; draw(true); log(`${RESULT[a][0]}: ${RESULT[a][1]}`, 'info'); }
    });
    return {
      open, close, live, draw,
      openRule(id) { if (ADV[id]) open(ADV[id]()); },
      openGuide(key) { const gd = GUIDES.find(x => x.key === key); if (gd) open(gd.make()); },
      /* new rule: open on its own unless something more important is showing */
      auto(r) {
        const item = ADV[r.id] && ADV[r.id]();
        if (!item) return;
        if (r.emergency || r.id === 'HYPOXIA_ACUTE') { if (!cur || !cur.em) open(item); return; }
        if (cur && !min && (cur.em || cur.level === 'critical')) return;
        if (cur && cur.key === item.key) return;
        open(item, false);
      },
      get current() { return cur; }
    };
  })();

  /* ---------- figure: smooth mannequin from elliptical cross-sections [y, x, z, rx, rz]; height = 100 ---------- */
  let LIMBS = [];
  function limb(zone, Sx, sx, rings) {
    const n = Sx.length, P = [];
    for (let i = 0; i < n - 1; i++) {
      const a = Sx[Math.max(0, i - 1)], b = Sx[i], c = Sx[i + 1], d = Sx[Math.min(n - 1, i + 2)];
      for (let s = 0; s < 5; s++) { const t = s / 5, t2 = t * t, t3 = t2 * t; P.push(b.map((_, j) => 0.5 * (2 * b[j] + (c[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t3))); }
    }
    P.push(Sx[n - 1].slice()); P.forEach(p => { p[1] *= sx; p[3] = Math.max(0.05, p[3]); p[4] = Math.max(0.05, p[4]); });
    const m = P.length;
    LIMBS.push({ zone, P, m, cx: new Float32Array(m), hw: new Float32Array(m), depth: 0, path: null,
      rings: (rings || []).map(y => { let b = 0; for (let i = 1; i < m; i++) if (Math.abs(P[i][0] - y) < Math.abs(P[b][0] - y)) b = i; return b; }) });
  }
  /* female variant: narrower shoulders and waist, wider hips, bust, slimmer limbs, hair down to the neck */
  const FEM = {
    head: p => p[0] < 13 ? [p[0], p[1], p[2], p[3] * .95, p[4] * .95] : [p[0], p[1], p[2], p[3] * .88, p[4] * .9],
    torso: p => { const y = p[0], w = Math.exp(-(((y - 26.5) / 3.2) ** 2)), sh = y < 24 ? .88 : 1, wa = Math.exp(-(((y - 38) / 4) ** 2)), hp = Math.exp(-(((y - 48) / 4.5) ** 2));
      return [y, p[1], p[2] - 1.3 * w, p[3] * sh * (1 - .2 * wa + .2 * hp), p[4] * (1 + .05 * hp) + 1.6 * w]; },
    legs: p => [p[0], p[1] + .45 * Math.max(0, 1 - (p[0] - 48) / 50) * Math.sign(p[1]), p[2], p[3] * .95, p[4] * .95],
    arms: p => [p[0], p[1] - 1.15 * Math.sign(p[1]), p[2], p[3] * .88, p[4] * .88]
  };
  let bodySex = null, PTS = null, NP = 0;
  function build(F) {
    LIMBS = [];
    const L = (zone, Sx, sx, rings) => limb(zone, F ? Sx.map(q => FEM[zone]([q[0], q[1] * sx, q[2], q[3], q[4]])).map(q => (q[1] *= sx, q)) : Sx, sx, rings);
    L('head', [[0, 0, .3, .3, .4], [.5, 0, .3, 1.9, 2.3], [1.5, 0, .3, 3.1, 3.8], [3, 0, .3, 3.9, 4.7], [5, 0, .2, 4.25, 5], [7, 0, 0, 4.2, 4.8], [8.8, 0, -.3, 3.9, 4.4], [10.4, 0, -.6, 3.3, 3.9], [11.6, 0, -.9, 2.5, 3.1], [12.5, 0, -1, 1.6, 2.2], [12.9, 0, -1, .5, .9]], 1);
    L('head', [[10.5, 0, .6, 2.5, 2.8], [13, 0, .5, 2.55, 2.8], [15, 0, .4, 2.7, 2.9], [16.3, 0, .3, 3.1, 3.1], [17.4, 0, .2, 4.2, 3.4]], 1);
    L('torso', [[16.8, 0, .2, 3.6, 3.2], [17.8, 0, .2, 7.6, 3.7], [18.9, 0, .1, 10.4, 4.4], [20.5, 0, 0, 10.9, 5.2], [23, 0, -.3, 10.3, 5.9], [26, 0, -.5, 9.9, 6.2], [29.5, 0, -.4, 9.3, 6], [33, 0, -.2, 8.6, 5.5], [36.5, 0, 0, 8, 5.1], [39.5, 0, 0, 7.9, 5], [42.5, 0, .1, 8.3, 5.3], [45.5, 0, .3, 9.1, 5.8], [48.5, 0, .5, 9.7, 6.2], [51, 0, .5, 9.6, 6.1], [53, 0, .3, 7.5, 5.2], [54.2, 0, .2, 3.5, 3.5]], 1, [23.5, 31, 39.5, 48.5]);
    const ARMY = p => [19.8 + (p[0] - 19.8) * 1.045, p[1], p[2], p[3], p[4]];
    for (const s of [-1, 1]) {
      L('legs', [[48.5, 4.9, .3, 4.6, 5.6], [52, 5, .2, 4.75, 5.7], [56, 5, 0, 4.6, 5.5], [61, 4.9, -.1, 4.1, 5], [66, 4.8, -.1, 3.5, 4.3], [70, 4.7, -.1, 3.05, 3.6], [72.5, 4.7, -.3, 3, 3.5], [75, 4.7, 0, 2.9, 3.4], [78.5, 4.8, .5, 3.15, 3.8], [82.5, 4.8, .5, 2.9, 3.5], [87, 4.7, .3, 2.2, 2.6], [91.5, 4.6, .1, 1.7, 2], [94.5, 4.6, 0, 1.6, 1.9], [96.3, 4.7, -1, 2, 3.2], [97.8, 4.9, -3, 2.5, 5.4], [99.2, 5, -3.8, 2.6, 6.4], [100, 5, -3.8, 2.4, 6.2]], s, [59, 72.5, 81, 94.5]);
      /* arm with a slimmer wrist and a tapered, flatter hand (v3 review: hands looked blunt) */
      L('arms', [[18.6, 10.6, 0, 1.6, 2.6], [19.8, 11, 0, 2.5, 3], [22, 11.4, 0, 2.7, 3.1], [25.5, 11.9, 0, 2.5, 2.9], [29.5, 12.5, 0, 2.3, 2.7], [33.5, 13.1, .1, 2.1, 2.4], [36.5, 13.6, .2, 1.9, 2.1], [39, 14, 0, 2.05, 2.2], [42.5, 14.6, -.4, 1.9, 2], [46, 15.2, -.8, 1.5, 1.6],
        [48.6, 15.6, -1.1, 1.1, 1.45], [49.8, 15.75, -1.2, 1, 1.75], [51.3, 15.95, -1.35, 1.05, 2.15], [52.9, 16.1, -1.45, 1.05, 2.25], [54.4, 16.2, -1.5, .95, 2.05], [55.7, 16.3, -1.5, .8, 1.75], [56.9, 16.35, -1.45, .6, 1.35], [57.8, 16.4, -1.4, .38, .9], [58.3, 16.4, -1.4, .15, .4]].map(ARMY), s, [27, 37.9]);
      L('arms', [[50, 15.45, -2.1, .52, .56], [51.3, 15.3, -2.9, .5, .54], [52.6, 15.25, -3.35, .44, .46], [53.7, 15.25, -3.5, .34, .36], [54.4, 15.25, -3.45, .14, .16]].map(ARMY), s);
    }
    if (F) { limb('hair', [[-.4, 0, .9, .6, .6], [.8, 0, 1, 3.3, 3.9], [2.8, 0, 1.1, 4.6, 5.3], [5.3, 0, 1.3, 4.85, 5.5], [8, 0, 1.6, 4.65, 5.1], [10.6, 0, 2, 4.3, 4.4], [13, 0, 2.2, 4.1, 3.6], [15.5, 0, 2.3, 4.2, 3.2], [17.6, 0, 2.4, 4.4, 2.8], [18.6, 0, 2.4, 2, 1.4]], 1); }
    /* particle cloud on each surface, sampled by area so the density is even */
    const out = [], ZI = { head: 0, hair: 0, chest: 1, abdomen: 2, body: 3 };
    for (const Lb of LIMBS) { const P = Lb.P;
      for (let i = 0; i < Lb.m - 1; i++) { const a = P[i], b = P[i + 1], dy = Math.abs(b[0] - a[0]), per = Math.PI * (a[3] + a[4] + b[3] + b[4]) / 2, n = per * dy * 1.25 + Math.random();
        for (let j = 0; j < (n | 0); j++) { const u = Math.random(), q = a.map((v, k) => v + (b[k] - v) * u), th = Math.random() * TAU;
          if (Lb.zone === 'hair' && Math.sin(th) < -.15 && q[0] > 4) continue;
          const y = q[0], z0 = Lb.zone === 'torso' ? (y < 34 ? 'chest' : 'abdomen') : Lb.zone === 'head' || Lb.zone === 'hair' ? 'head' : 'body', inn = Math.pow(Math.random(), .22);
          out.push(y, q[1], q[2], q[3] * Math.cos(th) * inn, q[4] * Math.sin(th) * inn, q[3], q[4], ZI[z0], Math.random()); } } }
    PTS = new Float32Array(out); NP = out.length / 9;
  }
  const SPC = new Map();
  function sprite(q) {
    const key = q.join(','); let cv = SPC.get(key); if (cv) return cv;
    cv = document.createElement('canvas'); cv.width = cv.height = 32; const x = cv.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(.25, `rgba(${key},.85)`); g.addColorStop(.6, `rgba(${key},.25)`); g.addColorStop(1, `rgba(${key},0)`);
    x.fillStyle = g; x.fillRect(0, 0, 32, 32); SPC.set(key, cv); return cv;
  }
  let SPR = [], sprBase = '';
  const AMB = Array.from({ length: 260 }, () => [Math.random(), Math.random(), Math.random(), Math.random()]);
  const ZL = { head: ['head', 'hair'], chest: ['torso'], abdomen: ['torso'], body: ['arms', 'legs'] }, ZY = { chest: [16, 35.5], abdomen: [33, 56] };
  const ANCH = { head: [0, 5.5, -4.6], chest: [-2.4, 25, -6], abdomen: [0, 43, -5.2], body: [13.4, 35, -2.6] };
  const ZONE_CH = { head: ['mood', 'sleep', 'air_co2'], chest: ['hr', 'bp', 'spo2'], abdomen: ['glucose'], body: ['temp', 'radiation'] };
  const FIG = surface($('#fig'), 2), ofs = document.createElement('canvas'), oc = ofs.getContext('2d');
  let rot = .45, drag = null, lastBeat = 0, pick = null, geo = null;
  {
    const cv = FIG.cv, end = () => { drag = null; };
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, a: rot, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
    cv.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x; if (Math.abs(dx) > 5) drag.moved = true; if (drag.moved) rot = drag.a + dx * .012; });
    cv.addEventListener('pointerup', e => { const moved = drag && drag.moved; end(); if (!moved) zoneAt(e); });
    cv.addEventListener('pointercancel', end);
  }
  function zoneAt(e) {
    if (!geo || !R) return;
    const r = FIG.cv.getBoundingClientRect(), x = (e.clientX - r.left - geo.fx) / geo.k, y = (e.clientY - r.top - geo.fy) / geo.k;
    if (y < -2 || y > 102 || Math.abs(x) > 24) return;
    let z = y < 16.8 ? 'head' : Math.abs(x) > 10.5 && y < 60 ? 'body' : y < 34 ? 'chest' : y < 55 ? 'abdomen' : 'body';
    pick = { z, t: performance.now() };
    const names = { head: 'Head', chest: 'Chest', abdomen: 'Belly', body: 'Whole body' };
    const parts = ZONE_CH[z].map(id => { const c = R.channels[id]; return `${S.def(id).name.toLowerCase()} ${c.active ? fmt(id, c.value) + ' ' + unitOf(id) + ', ' + WORD[c.state].toLowerCase() : 'not connected'}`; });
    say(`${names[z]}: ${parts.join('; ')}.`);
    ZONE_CH[z].forEach(id => $$(`[data-ch=${id}]`).forEach(el => { if (el.matches('#wbar i')) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }));
  }
  function drawFig(t) {
    const { c, w, h, r } = FIG; if (!w || !R) return;
    const sx = prof.sex === 'F' ? 'F' : 'M'; if (sx !== bodySex) { bodySex = sx; build(sx === 'F'); }
    c.setTransform(r, 0, 0, r, 0, 0); c.clearRect(0, 0, w, h);
    const narrow = innerWidth <= 820, top = narrow ? 10 : h * .06 + 18, bot = narrow ? 8 : h * .05 + 8;
    const fl = RM.matches ? 0 : 1, rv = rot + (drag ? 0 : Math.sin(t * .0004) * .15 * fl), k = Math.min((h - top - bot) / 100, w / 46) * .96, Sz = k * 125, fx = narrow ? w * .6 : w * .54, fy = top + (h - top - bot - 100 * k) / 2 + Math.sin(t * .0014) * 1.6 * k * fl, ca = Math.cos(rv), sa = Math.sin(rv);
    geo = { fx, fy, k };
    const tone = R.emergency ? 'critical' : 'info', mc = RGB[tone], col = (a, q) => `rgba(${(q || mc).join(',')},${a})`;
    let gr;
    const U = new Path2D();
    for (const L of LIMBS) {
      const P = L.P, m = L.m;
      for (let i = 0; i < m; i++) { const p = P[i]; L.cx[i] = p[1] * ca + p[2] * sa; L.hw[i] = Math.hypot(p[3] * ca, p[4] * sa); }
      const q = new Path2D(); q.moveTo((L.cx[0] - L.hw[0]) * k, P[0][0] * k);
      for (let i = 1; i < m; i++) q.lineTo((L.cx[i] - L.hw[i]) * k, P[i][0] * k);
      for (let i = m - 1; i >= 0; i--) q.lineTo((L.cx[i] + L.hw[i]) * k, P[i][0] * k);
      q.closePath(); L.path = q; U.addPath(q);
    }
    const bw = 48 * k;
    /* particle hologram: soft inner glow, a dotted surface, sparks around it and a stream falling from the feet */
    const lit = {}; for (const zk in R.zones) lit[zk] = R.zones[zk] === 'critical' ? 'critical' : 'nominal';
    R.rules.forEach(r => { if (lit[r.zone] !== 'critical') lit[r.zone] = r.level; });
    const mark = R.zones, pk = pick && performance.now() - pick.t < 2200 ? pick.z : null, still = RM.matches ? 0 : 1;
    const base = R.emergency ? [255, 150, 140] : [165, 205, 255], ZN = ['head', 'chest', 'abdomen', 'body'];
    const zc = ZN.map(zk => lit[zk] && lit[zk] !== 'nominal' ? RGB[lit[zk]] : pk === zk ? [150, 205, 255] : base);
    if (sprBase !== base.join()) { sprBase = base.join(); SPR = [0, 1, 2, 3].map(j => sprite(base.map(v => Math.round(v + (255 - v) * j * .22)))); }
    c.save(); c.translate(fx, fy);
    gr = c.createLinearGradient(0, 0, 0, 100 * k);
    gr.addColorStop(0, col(.16, base)); gr.addColorStop(.5, col(.09, base)); gr.addColorStop(1, col(.06, base));
    c.fillStyle = gr; c.fill(U);
    /* glass: a light sheen down the left side and a darker right side, like the panels */
    c.save(); c.clip(U); gr = c.createLinearGradient(-bw / 2, 0, bw / 2, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.36, 'rgba(255,255,255,.10)'); gr.addColorStop(.46, 'rgba(255,255,255,.02)'); gr.addColorStop(.75, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.18)'); c.fillStyle = gr; c.fillRect(-bw / 2, -4 * k, bw, 110 * k); c.restore();
    for (let z = 0; z < 4; z++) { const zk = ZN[z]; if (zc[z] === base) continue; c.save();
      if (ZY[zk]) { c.beginPath(); c.rect(-bw / 2, ZY[zk][0] * k, bw, (ZY[zk][1] - ZY[zk][0]) * k); c.clip(); }
      c.fillStyle = col((zk === 'body' ? .06 : .13) + .06 * Math.sin(t * .006) * still, zc[z]);
      for (const L of LIMBS) if (ZL[zk].includes(L.zone)) c.fill(L.path); c.restore(); }
    const halo = (x, y, rad, a) => { const g2 = c.createRadialGradient(x, y, 0, x, y, rad); g2.addColorStop(0, col(a, [235, 245, 255])); g2.addColorStop(.35, col(a * .45, base)); g2.addColorStop(1, col(0, base)); c.fillStyle = g2; c.beginPath(); c.arc(x, y, rad, 0, TAU); c.fill(); };
    c.globalCompositeOperation = 'lighter';
    halo(Math.sin(rv) * .6 * k, 6 * k, 9 * k, .5);
    halo(0, 98 * k, 10 * k, .55);
    const ds = Math.max(.6, k * .24), tw = t * .004, gs = Math.max(2, k * .85);
    /* hologram dots: soft glow sprites added together, so dense areas (the silhouette edge) glow brighter on their own */
    for (let i = 0, o = 0; i < NP; i++, o += 9) {
      const y = PTS[o], ox = PTS[o + 3], oz = PTS[o + 4], zi = PTS[o + 7], rn = PTS[o + 8], x = PTS[o + 1] + ox, z = PTS[o + 2] + oz;
      if (((rn * 7919) % 1) > (y > 60 ? .35 : .55)) continue;
      const X = (x * ca + z * sa) * k, back = z * ca - x * sa > 0 ? .55 : 1, tws = .5 + .5 * Math.sin(tw * (1 + rn) + rn * 40);
      c.globalAlpha = back * (.1 + .14 * tws * still + (1 - still) * .07);
      const sp = zc[zi] === base ? SPR[(rn * 4) | 0] : sprite(zc[zi]), sz = gs * (.6 + rn * .85);
      c.drawImage(sp, X - sz / 2, y * k - sz / 2, sz, sz);
    }
    for (let i = 0; i < AMB.length; i++) { const A = AMB[i], st = i < 190;
      let x, y, sz;
      if (st) { const th = A[0] * TAU, rr = 5 + A[1] * A[1] * 24; x = Math.cos(th + rv) * rr; y = ((A[2] * 112 - t * .0018 * (.5 + A[3]) * still) % 112 + 112) % 112 - 8; sz = gs * (1 + A[3] * 1.4); }
      else { const u = (A[2] + t * .00012 * (.6 + A[3]) * still) % 1; y = 124 - u * 26; x = (A[0] - .5) * (4 + (1 - u) * 14) * A[1]; sz = gs * (.7 + u) * (.8 + A[3]); }
      c.globalAlpha = (st ? .1 + .28 * A[3] : .6 * Math.min(1, (124 - y) / 8)) * (.6 + .4 * Math.sin(tw * 2 + i) * still);
      c.drawImage(A[3] > .7 ? SPR[3] : zc[3] === base ? SPR[1] : sprite(zc[3]), x * k - sz / 2, y * k - sz / 2, sz, sz);
    }
    c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    /* solid main edges with a soft outer glow, joint rings and a centre line as detail */
    c.lineJoin = 'round';
    c.strokeStyle = col(.16, base); c.lineWidth = Math.max(2.5, k * .9); for (const L of LIMBS) c.stroke(L.path);
    c.strokeStyle = col(.85, base.map(v => Math.round(v + (255 - v) * .5))); c.lineWidth = Math.max(1, k * .22); for (const L of LIMBS) c.stroke(L.path);
    c.lineWidth = Math.max(.7, k * .12);
    for (const L of LIMBS) for (const ii of L.rings) { const x0 = L.cx[ii] * k, y0 = L.P[ii][0] * k, rx = L.hw[ii] * k, ry = Math.max(1, rx * .2);
      c.strokeStyle = col(.42, base); c.beginPath(); c.ellipse(x0, y0, rx, ry, 0, 0, Math.PI); c.stroke();
      c.strokeStyle = col(.14, base); c.beginPath(); c.ellipse(x0, y0, rx, ry, 0, Math.PI, TAU); c.stroke(); }
    { const T = LIMBS.find(L => L.zone === 'torso'); if (T) { c.strokeStyle = col(.22, base); c.setLineDash([2, 4]); c.beginPath(); for (let ii = 2; ii < T.m - 3; ii++) { const x0 = T.cx[ii] * k; ii === 2 ? c.moveTo(x0, T.P[ii][0] * k) : c.lineTo(x0, T.P[ii][0] * k); } c.stroke(); c.setLineDash([]); } }
    if (still) { const sy = (50 + Math.sin(t * .0007) * 56) * k, sh = 7 * k; c.save(); c.clip(U); gr = c.createLinearGradient(0, sy - sh, 0, sy + sh); gr.addColorStop(0, 'rgba(200,220,250,0)'); gr.addColorStop(.5, R.emergency ? 'rgba(255,150,140,.2)' : 'rgba(215,230,250,.16)'); gr.addColorStop(1, 'rgba(200,220,250,0)'); c.fillStyle = gr; c.fillRect(-bw / 2, sy - sh, bw, sh * 2); c.restore(); }
    const mk = (A, q, p, big) => { const x = (A[0] * ca + A[2] * sa) * k, y = A[1] * k, back = A[2] * ca - A[0] * sa > 1.5 ? .35 : 1, s = Sz / 480;
      c.fillStyle = col(.95 * back, q); c.beginPath(); c.arc(x, y, 2.4 * s, 0, TAU); c.fill();
      c.strokeStyle = col((1 - p) * .85 * back, q); c.lineWidth = 1.3; c.beginPath(); c.arc(x, y, (3 + p * (big ? 16 : 10)) * s, 0, TAU); c.stroke(); };
    const hp = clamp((t - lastBeat) / 520, 0, 1), hs = R.channels.hr.state;
    if (R.channels.hr.active) mk(ANCH.chest, RGB[R.emergency ? 'critical' : hs === 'nominal' ? 'info' : hs], RM.matches ? .4 : hp, 1);
    for (const zk in ANCH) { if (zk === 'chest' && R.channels.hr.active) continue; const st = mark[zk]; if (st !== 'nominal') mk(ANCH[zk], RGB[st], RM.matches ? .4 : (t * .0011) % 1, 0); }
    c.restore();
  }

  /* ---------- pulse trace: thin PQRST, red in an emergency, flat when no sensor ---------- */
  const ECG = (() => {
    const Sf = surface($('#ecg'), 2), DX = .75; let buf = null, n = 0, head = 0, frac = 0, ts = 0, tb = 0, rr = 60 / 64, fired = false, key = '';
    const bpm = () => (R && R.channels.hr.active ? R.channels.hr.value : 0);
    const wave = dt => { if (!bpm()) return 0; const s = clamp(Math.sqrt(rr), .58, 1.06), tr = .2 * s, gg = (m, sd, a) => a * Math.exp(-(dt - m) * (dt - m) / (2 * sd * sd));
      return gg(.085 * s, .024 * s, .1) + gg(tr - .034, .012, -.12) + gg(tr, .016, 1) + gg(tr + .038, .013, -.22) + gg(tr + .25 * s, .045 * s, .24); };
    const speed = () => Sf.w / 2.9 * Math.pow(clamp((bpm() || 64) / 64, .75, 2.3), .5);
    function col(q) { ts += DX / speed(); let dt = ts - tb; if (dt >= rr) { tb += rr; rr = 60 / clamp(bpm() || 64, 30, 220) * (1 + (Math.random() - .5) * .05); dt = ts - tb; fired = false; }
      if (!fired && dt >= .2 * clamp(Math.sqrt(rr), .58, 1.06)) { fired = true; if (!q && bpm()) beat(); } buf[head] = wave(dt); head = (head + 1) % n; }
    function draw(dt) {
      const { c, w, h, r } = Sf; if (!w) return; const k = w + 'x' + h;
      if (k !== key) { key = k; n = Math.max(8, Math.ceil(w / DX)); buf = new Float32Array(n); head = 0; frac = 0; for (let i = 0; i < n - 10; i++) col(true); }
      frac += dt * speed() / DX; let st = Math.min(n >> 1, frac | 0); frac -= frac | 0; while (st--) col(false);
      const s = R ? (R.emergency ? 'critical' : R.channels.hr.state) : 'off', q = s === 'nominal' ? [236, 242, 250] : RGB[s];
      c.setTransform(r, 0, 0, r, 0, 0); c.clearRect(0, 0, w, h);
      c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = 1; c.beginPath(); for (let x = 0; x < w; x += 16) { c.moveTo(x + .5, h - 4); c.lineTo(x + .5, h); } c.stroke();
      const hx = head * DX, gap = Math.ceil(12 / DX), Yf = v => h * .74 - v * h * .62, al = x => 1 - .85 * (x <= hx ? hx - x : hx + w - x) / w;
      c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = s === 'critical' ? 1.6 : 1.25;
      for (const [a, b] of [[0, head - 1], [head + gap, n - 1]]) { if (b - a < 2) continue; const x0 = a * DX, x1 = b * DX, gd = c.createLinearGradient(x0, 0, x1, 0);
        gd.addColorStop(0, `rgba(${q},${al(x0).toFixed(3)})`); gd.addColorStop(1, `rgba(${q},${al(x1).toFixed(3)})`); c.strokeStyle = gd; c.beginPath(); c.moveTo(x0, Yf(buf[a])); for (let i = a + 1; i <= b; i++) c.lineTo(i * DX, Yf(buf[i])); c.stroke(); }
      if (head > 0) { c.fillStyle = s === 'critical' ? '#d0605a' : '#fff'; c.beginPath(); c.arc(hx - DX, Yf(buf[head - 1]), 1.5, 0, TAU); c.fill(); }
    }
    return { draw };
  })();
  function beat() { lastBeat = performance.now(); if (RM.matches) return; $$('.beat').forEach(e => e.animate && e.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.32)' }, { transform: 'scale(1)' }], { duration: 280, easing: 'ease-out' })); }

  /* ---------- background: stars everywhere; black hole behind the panels, as in v3 ---------- */
  const HOLE = (() => {
    const Sf = surface($('#space'), 1.5), c = Sf.c, INC = -.2, LE = 1.32, PD = 3.4;
    let X = 0, Y = 0, Rh = 40, low = false, cost = 0, FIB = null, tip = null, stars = null, ver = -1, box = null;
    const azar = s => () => { s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    function init() {
      const r = azar(2613), GAPS = [[4.3, 4.7], [5.9, 6.6], [7.8, 8.9], [10, 10.4], [11.2, 12.6]]; FIB = { d: [], up: [], dn: [] };
      for (let i = 0; i < 260; i++) { const u = Math.pow(r(), 2.1), d = 1.5 + 13 * u; if (GAPS.some(gp => d > gp[0] && d < gp[1]) || (d > 4 && r() < (d - 4) / 16)) { i--; continue; }
        FIB.d.push({ d, a: r() * TAU, l: .2 + r() * (1.3 - u * .7), w: .3 + r() * (1.5 - u), al: (.3 + r() * .7) * (1 - u * .4), dy: (r() - .5) * (.12 + u * .5) }); }
      for (let i = 0; i < 220; i++) FIB.up.push({ u: Math.pow(r(), 1.6), a: r(), l: .12 + r() * .55, w: .3 + r() * 1.2, al: .3 + r() * .7, v: .04 + r() * .14 });
      for (let i = 0; i < 110; i++) FIB.dn.push({ u: Math.pow(r(), 1.5), a: r(), l: .12 + r() * .55, w: .3 + r() * .9, al: .3 + r() * .7, v: .04 + r() * .14 });
      stars = Array.from({ length: 190 }, () => [r(), r(), r() * .7 + .15, r() * TAU, .4 + r() * 1.3, r() < .14 ? 1.7 : 1]);
      tip = document.createElement('canvas'); tip.width = tip.height = 32; const x = tip.getContext('2d'), gd = x.createRadialGradient(16, 16, 0, 16, 16, 16);
      gd.addColorStop(0, 'rgba(255,255,255,1)'); gd.addColorStop(.3, 'rgba(215,235,255,.5)'); gd.addColorStop(1, 'rgba(215,235,255,0)'); x.fillStyle = gd; x.fillRect(0, 0, 32, 32);
    }
    function lens(p, z, Eh) { let w = .5 + z / (Rh * 3); if (w <= 0) return; if (w > 1) w = 1; w = w * w * (3 - 2 * w); const dx = p[0] - X, dy = p[1] - Y, b = Math.sqrt(dx * dx + dy * dy) || .001, f = (b + Math.sqrt(b * b + 4 * Eh * Eh * w)) / (2 * b); p[0] = X + dx * f; p[1] = Y + dy * f; }
    const AL = [.17, .33, .5, .67, .83, 1], WL = [.4, .8, 1.3], lot = (al, w) => Math.min(5, Math.max(0, Math.round(al * 6) - 1)) * 3 + (w < .6 ? 0 : w < 1.05 ? 1 : 2), lots = () => Array.from({ length: 18 }, () => []);
    function disc(gm, t, front, k) {
      const dp = Sf.r, big = (Sf.w + Sf.h) * 2, A = gm.A, B = gm.B, nx = gm.N[0], ny = gm.N[1], F = FIB.d, st = low ? 2 : 1, lp = [0, 0], pa = Rh * .32;
      c.save(); c.translate(X, Y); c.rotate(gm.fi); c.beginPath(); if (front === gm.down) c.rect(-big, 0, big * 2, big); else c.rect(-big, -big, big * 2, big); c.clip(); c.setTransform(dp, 0, 0, dp, 0, 0);
      const Dx = Math.cos(gm.fi), Dy = Math.sin(gm.fi), Lg = Rh * 9, gd = c.createLinearGradient(X - Dx * Lg, Y - Dy * Lg, X + Dx * Lg, Y + Dy * Lg);
      gd.addColorStop(0, 'rgba(235,245,255,0)'); gd.addColorStop(.2, 'rgba(240,248,255,1)'); gd.addColorStop(.5, 'rgba(206,229,255,1)'); gd.addColorStop(.8, 'rgba(126,172,236,.62)'); gd.addColorStop(1, 'rgba(126,172,236,0)');
      c.strokeStyle = gd; c.lineCap = 'round';
      const ring = (rr, oy, a0, a1) => { const nn = Math.min(160, Math.ceil((a1 - a0) * rr / pa) + 2); for (let s = 0; s <= nn; s++) { const an = a0 + (a1 - a0) * s / nn, cs = Math.cos(an) * rr, sn = Math.sin(an) * rr; lp[0] = X + A[0] * cs + B[0] * sn; lp[1] = Y + A[1] * cs + B[1] * sn; lens(lp, A[2] * cs + B[2] * sn, LE * Rh); s ? c.lineTo(lp[0] + nx * oy, lp[1] + ny * oy) : c.moveTo(lp[0] + nx * oy, lp[1] + ny * oy); } };
      for (let b = 0; b < 4; b++) { c.globalAlpha = k * [.1, .05, .03, .02][b]; c.beginPath(); ring(Rh * [2.2, 3.1, 4.7, 6][b], 0, 0, TAU); c.lineWidth = Rh * [.3, .4, .5, .4][b] * (.4 + gm.apl * 3); c.stroke(); }
      const L = lots(); for (let i = 0; i < F.length; i += st) L[lot(F[i].al, F[i].w)].push(F[i]);
      for (let q = 0; q < 18; q++) { const l = L[q]; if (!l.length) continue; c.beginPath(); for (const e of l) { const a0 = e.a + t * 1.1 / Math.pow(e.d, 1.5); ring(Rh * e.d, e.dy * Rh * .42, a0, a0 + e.l); } c.globalAlpha = Math.min(1, AL[q / 3 | 0] * k); c.lineWidth = WL[q % 3]; c.stroke(); }
      c.restore(); c.globalAlpha = 1;
    }
    function lensArcs(gm, t, k) {
      const st = low ? 2 : 1, ap = gm.apl, Dx = Math.cos(gm.fi), Dy = Math.sin(gm.fi), gv = c.createLinearGradient(X - Dx * Rh * 2, Y - Dy * Rh * 2, X + Dx * Rh * 2, Y + Dy * Rh * 2);
      gv.addColorStop(0, 'rgba(245,250,255,1)'); gv.addColorStop(.55, 'rgba(214,234,255,.95)'); gv.addColorStop(1, 'rgba(140,182,240,.75)'); c.strokeStyle = gv; c.lineCap = 'round';
      const upA = gm.down ? Math.PI : 0, cf = Math.cos(gm.fi), sf = Math.sin(gm.fi);
      for (const B of [[FIB.up, 1.04, .95 - .4 * ap, .98, .62, upA], [FIB.dn, 1.04, .62 - .1 * ap, .97, .5 + .12 * ap, upA + Math.PI]]) {
        const Lf = B[0], a0B = B[5];
        for (let j = 0; j < 4; j++) { const rr = Rh * (B[1] + B[2] * [.08, .25, .5, .8][j]); c.globalAlpha = k * B[4] * [.16, .08, .04, .02][j]; c.lineWidth = Rh * B[2] * [.25, .4, .55, .7][j]; c.beginPath(); c.ellipse(X, Y, rr, rr * B[3], gm.fi, a0B - .08, a0B + Math.PI + .08); c.stroke(); }
        const L = lots(); for (let i = 0; i < Lf.length; i += st) { const f = Lf[i], pos = ((f.a + t * f.v) % 1) * (1 + f.l) - f.l, s0 = Math.max(0, pos), s1 = Math.min(1, pos + f.l); if (s1 <= s0) continue; L[lot(f.al * B[4] * (1.08 - .7 * f.u), f.w)].push(f, a0B + s0 * Math.PI, a0B + s1 * Math.PI); }
        for (let q = 0; q < 18; q++) { const l = L[q]; if (!l.length) continue; c.beginPath(); for (let i = 0; i < l.length; i += 3) { const r2 = Rh * (B[1] + B[2] * l[i].u), ex = Math.cos(l[i + 1]) * r2, ey = Math.sin(l[i + 1]) * r2 * B[3]; c.moveTo(X + ex * cf - ey * sf, Y + ex * sf + ey * cf); c.ellipse(X, Y, r2, r2 * B[3], gm.fi, l[i + 1], l[i + 2]); }
          c.globalAlpha = Math.min(1, AL[q / 3 | 0] * k); c.lineWidth = WL[q % 3]; c.stroke(); }
      }
      c.globalAlpha = 1;
    }
    function photons(gm, t, k) {
      const rf = Rh * .9, Dx = Math.cos(gm.fi), Dy = Math.sin(gm.fi);
      const gh = c.createLinearGradient(X - Dx * rf, Y - Dy * rf, X + Dx * rf, Y + Dy * rf); gh.addColorStop(0, 'rgba(255,255,255,1)'); gh.addColorStop(.5, 'rgba(215,232,255,.8)'); gh.addColorStop(1, 'rgba(150,188,240,.55)'); c.strokeStyle = gh;
      [[1, 1.4, 1], [.955, .6, .45], [.915, .5, .25]].forEach((hl, i) => { c.globalAlpha = Math.min(1, hl[2] * k * (.9 + .1 * Math.sin(t * 2 + i))); c.lineWidth = hl[1]; c.beginPath(); c.ellipse(X, Y, rf * hl[0], rf * hl[0] * (.97 + .03 * (1 - gm.apl)), gm.fi, 0, TAU); c.stroke(); });
      for (let i = 0; i < 3; i++) { const a = t * (.35 + i * .13) + i * 2.1, rb = Rh * .12; c.globalAlpha = .55 * k; c.drawImage(tip, X + Math.cos(a) * rf - rb, Y + Math.sin(a) * rf * .97 - rb, rb * 2, rb * 2); }
      c.globalAlpha = 1;
    }
    /* three orbital rings */
    const ANI = [{ r: 1.55, az: 20, inc: 24, prec: .022, vel: .2 }, { r: 1.92, az: 140, inc: -38, prec: -.017, vel: -.15 }, { r: 2.3, az: 260, inc: 14, prec: .012, vel: .11 }];
    function trace(Xs, Ys, Zs, N, al, w, bk) { for (let side = 0; side < 2; side++) { c.globalAlpha = al * (side ? bk : 1); c.lineWidth = w * (side ? .8 : 1); c.beginPath(); let on = false;
      for (let s = 1; s <= N; s++) { if ((Zs[s] + Zs[s - 1] > 0 ? 1 : 0) !== side) { on = false; continue; } if (!on) { c.moveTo(Xs[s - 1], Ys[s - 1]); on = true; } c.lineTo(Xs[s], Ys[s]); } c.stroke(); } c.globalAlpha = 1; }
    function orbits(t, k) {
      const N = low ? 64 : 104, Ro = Rh * 1.55, e = clamp(Rh / 60, .7, 1.2), q = [0, 0]; c.lineCap = 'round'; c.strokeStyle = 'rgb(214,230,250)'; c.fillStyle = 'rgb(222,236,252)';
      ANI.forEach((A, o) => {
        const az = A.az * Math.PI / 180 + t * A.prec, inc = A.inc * Math.PI / 180, u = [Math.cos(az), 0, Math.sin(az)], v = [-Math.sin(az) * Math.cos(inc), Math.sin(inc), Math.cos(az) * Math.cos(inc)];
        const pr = (rr, th, Xs, Ys, Zs) => { const cs = Math.cos(th), sn = Math.sin(th), z = rr * (u[2] * cs + v[2] * sn), sc = PD / (PD + z * .5); q[0] = X + rr * (u[0] * cs + v[0] * sn) * Ro * sc; q[1] = Y + rr * (u[1] * cs + v[1] * sn) * Ro * sc; lens(q, z * Ro, LE * Rh * 1.25); Xs.push(q[0]); Ys.push(q[1]); Zs.push(z); };
        const X2 = [], Y2 = [], Z2 = []; for (let s = 0; s <= N; s++) pr(A.r, s / N * TAU, X2, Y2, Z2);
        if (o === 0) trace(X2, Y2, Z2, N, .4 * k, .8 * e, .35);
        else if (o === 1) { c.setLineDash([6 * e, 7 * e]); c.lineDashOffset = -t * 14 * Math.sign(A.vel); trace(X2, Y2, Z2, N, .42 * k, 1 * e, .3); c.setLineDash([]); }
        else { trace(X2, Y2, Z2, N, .45 * k, .9 * e, .3); for (let s = 0; s < N; s += 3) { const cz = 1.3 * e; c.globalAlpha = (Z2[s] > 0 ? .35 : 1) * .6 * k; c.fillRect(X2[s] - cz / 2, Y2[s] - cz / 2, cz, cz); } c.globalAlpha = 1; }
        const hp = ((t * A.vel / TAU + o * .37) % 1 + 1) % 1, hi = Math.floor(hp * N), hr = 7 * e; c.globalAlpha = Math.min(1, k * (Z2[hi] > 0 ? .45 : 1)); c.drawImage(tip, X2[hi] - hr, Y2[hi] - hr, hr * 2, hr * 2); c.globalAlpha = 1;
      });
    }
    function draw(t) {
      const w = Sf.w, h = Sf.h; if (!w) return; if (!FIB) init(); const t0 = performance.now();
      const wide = w > 900;
      if (innerWidth <= 820) { X = w; Y = h * .25; Rh = clamp(w * .26, 64, 120); }
      else if (wide) { const a = $('#avatar').getBoundingClientRect(); X = w * .75; Y = (a.top + a.bottom) / 2; Rh = clamp(h * .135, 40, 150); }
      else { X = w * .56; Y = h * .36; Rh = clamp(Math.min(w * .3, h * .2), 50, 150); }
      c.setTransform(Sf.r, 0, 0, Sf.r, 0, 0); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; c.clearRect(0, 0, w, h);
      c.fillStyle = '#dfeaff';
      for (const s of stars) { const x = s[0] * w, y = s[1] * h; if ((x - X) * (x - X) + (y - Y) * (y - Y) < Rh * Rh * 1.6) continue; c.globalAlpha = s[2] * (.55 + .45 * Math.sin(t * s[4] + s[3])); c.fillRect(x, y, s[5], s[5]); }
      c.globalAlpha = 1;
      const tilt = .12 + .035 * Math.sin(t * .06), ci = Math.cos(INC), si = Math.sin(INC), ct = Math.cos(tilt), stt = Math.sin(tilt), k = 1;
      const gm = { A: [ci, si, 0], B: [si * stt, -ci * stt, ct], N: [si * ct, -ci * ct, -stt], fi: INC, apl: Math.abs(stt), down: stt >= 0 };
      c.globalCompositeOperation = 'lighter'; orbits(t, k);
      c.save(); c.translate(X, Y); c.rotate(gm.fi); c.scale(1, Math.max(.12, gm.apl * 1.4)); let gl = c.createRadialGradient(0, 0, Rh, 0, 0, Rh * 7); gl.addColorStop(0, 'rgba(200,226,255,.34)'); gl.addColorStop(.45, 'rgba(170,208,255,.1)'); gl.addColorStop(1, 'rgba(190,220,255,0)'); c.fillStyle = gl; c.beginPath(); c.arc(0, 0, Rh * 7, 0, TAU); c.fill(); c.restore();
      gl = c.createRadialGradient(X, Y, Rh, X, Y, Rh * 6); gl.addColorStop(0, 'rgba(120,150,210,.07)'); gl.addColorStop(1, 'rgba(120,150,210,0)'); c.fillStyle = gl; c.beginPath(); c.arc(X, Y, Rh * 6, 0, TAU); c.fill();
      disc(gm, t, false, k); lensArcs(gm, t, k);
      c.globalCompositeOperation = 'source-over'; c.fillStyle = '#000'; c.beginPath(); c.arc(X, Y, Rh, 0, TAU); c.fill();
      c.globalCompositeOperation = 'lighter'; c.lineWidth = 1; c.strokeStyle = 'rgba(235,245,255,.9)'; c.beginPath(); c.arc(X, Y, Rh * 1.025, 0, TAU); c.stroke();
      photons(gm, t, k); disc(gm, t, true, k);
      c.globalCompositeOperation = 'source-over';
      cost = cost * .9 + (performance.now() - t0) * .1; if (cost > 11) low = true; ver = Sf.ver;
    }
    let lastY = null;
    return { draw, stale: () => ver !== Sf.ver };
  })();

  /* ---------- loop: background at 30 fps, figure and trace every frame; stops while the tab is hidden ---------- */
  let last = 0, lastBg = -1e9, raf = 0;
  function loop(t) {
    raf = requestAnimationFrame(loop); const dt = last ? Math.min(64, t - last) : 16; last = t;
    if (RM.matches) { if (HOLE.stale()) HOLE.draw(40); } else if (t - lastBg >= 31) { lastBg = t; HOLE.draw(t / 1000); }
    if (!RM.matches && !drag) rot += dt * .00028;
    drawFig(t); ECG.draw(dt / 1000);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf) { last = 0; raf = requestAnimationFrame(loop); } });

  /* ---------- public API ---------- */
  let adapterMsg = '';
  S.on('adapter', a => { adapterMsg = a.error || ''; if (a.state === 'error' || a.state === 'unsupported') log(`${a.kind.toUpperCase()}: ${a.error || 'connection failed'}`, 'watch'); if (a.state === 'open') log(`${a.kind.toUpperCase()} device connected: ${a.channels.map(id => S.def(id).name).join(', ')}`, 'nominal'); if (a.state === 'lost') log(`${a.kind.toUpperCase()} device lost`, 'watch'); });
  const Akari = {
    mode: MODE, store: S, engine: E, adapters: AD,
    /* Akari.ingest({glucose:112, spo2:97, bp:'118/77'}, 'LIVE') → ids accepted */
    ingest(values, source = 'LIVE', ts) { return AD.ingest(values, source, ts == null ? (source === 'LIVE' ? Date.now() : now()) : ts); },
    /* how: 'sim' | 'ble' | 'serial' | 'ws://…' | 'http…' | an adapter instance; without it: simulator in demo, else the entry popover */
    async connect(id, how) {
      const c = S.channel(id); if (!c) return false; id = c.id;
      if (how && typeof how === 'object' && how.connect) { if (!how.channels.includes(id)) how.channels.push(id); return how.connect(); }
      if (!how || how === 'demo') { if (MODE !== 'demo') return false; demoOff.delete(id); emit('connect', { id, how: 'demo' }); return true; }
      if (how === 'ble') { const p = AD.BLE_PROFILES[id] ? id : null; if (!p) { adapterMsg = 'This sensor has no Bluetooth profile.'; return false; } return new AD.BLEAdapter(p).connect(); }
      if (how === 'serial') return new AD.SerialAdapter([id]).connect();
      if (typeof how === 'string' && /^wss?:\/\//.test(how)) return new AD.WebSocketAdapter(how, { channels: [id] }).connect();
      if (typeof how === 'string' && /^https?:\/\//.test(how)) return new AD.RestPollingAdapter(how, { channels: [id] }).connect();
      return false;
    },
    disconnect(id) { const c = S.channel(id); if (!c) return false; demoOff.add(c.id); c.disconnect(); emit('disconnect', { id: c.id }); return true; },
    /* environment and personal temperature baseline (measured before or during the mission) */
    setEnv(k) { const e = E.setEnv(k); recompute(); return e.id; },
    setBaseline(t) { const c = S.channels.temp; if (Number.isFinite(+t)) { c.base = +t; c.baseFixed = true; } else { c.baseFixed = false; } recompute(); return c.base; },
    on(evt, fn) { (bus[evt] || (bus[evt] = [])).push(fn); return () => { const l = bus[evt]; l.splice(l.indexOf(fn), 1); }; },
    state: () => R,
    now, setClock(ms) { clock = ms; clockSet = Date.now(); }, get profile() { return prof; },
    guide: key => Dock.openGuide(key), openRule: id => Dock.openRule(id), closePanel: () => Dock.close(),
    log: (t, st) => log(t, st), get panel() { return Dock.current; }
  };
  S.on('status', s => {
    if (s.status === 'DISCONNECTED') log(`${S.def(s.id).name} disconnected · confidence recalculated`, 'off');
    else if (s.was === 'DISCONNECTED') log(`${S.def(s.id).name} connected`, 'nominal');
    emit('status', s);
  });
  S.on('change', recompute);
  g.Akari = Akari;

  /* ---------- internal demo: the profile walks through its day on a soft loop (60x). Paused while the simulator drives ---------- */
  const demoOff = new Set();
  let DM = null, lastSim = 0;
  const simOn = () => Date.now() - lastSim < 4000;
  if (MODE === 'demo' && g.AkariModel && URLP) {
    DM = g.AkariModel.create(URLP);
    let lr = performance.now();
    setInterval(() => {
      const t = performance.now(), dt = Math.min(2, (t - lr) / 1000); lr = t;
      if (simOn() || document.hidden) return;
      if (lastSim) { lastSim = 0; prof = Object.assign({}, base(), saved); renderProf(); render(); log('Simulator window gone · internal demo resumed', 'info'); }
      DM.step(dt); const all = DM.values(), out = {};
      S.order.forEach(id => { if (!demoOff.has(id)) out[id] = all[id]; });
      Akari.setClock(DM.t);
      if (Object.keys(out).length) Akari.ingest(out, 'SIMULATED', DM.t);
    }, 1000);
  }

  /* an internal test tool may write here over BroadcastChannel; same browser and device only */
  let BC = null;
  try {
    BC = new BroadcastChannel('akari');
    BC.onmessage = ev => { const m = ev.data || {}; if (m.from !== 'sim') return;
      const was = simOn(); lastSim = Date.now();
      if (!was) log('Simulator window connected', 'info');
      if (m.type === 'profile' && m.profile) { prof = Object.assign({}, LIVEP, m.profile); renderProf(); render(); }
      if (m.type === 'ingest') Akari.ingest(m.values, m.source || 'SIMULATED', m.ts);
      if (m.type === 'disconnect') { const c = S.channel(m.id); if (c) { c.disconnect(); emit('disconnect', { id: c.id }); } }
      if (m.type === 'clock') Akari.setClock(m.ts);
      if (m.type === 'guide') Akari.guide(m.key);
      if (m.type === 'log') log(m.text, m.st);
      if (m.type === 'bye') { lastSim = 0; prof = Object.assign({}, base(), saved); renderProf(); render(); log('Simulator window closed · internal demo resumed', 'info'); }
      if (m.type === 'hello') recompute(); };
    BC.postMessage({ type: 'app', from: 'app' });
  } catch (e) { BC = null; }

  /* ---------- mobile: notes, guides and sensors fold into bottom drawers ---------- */
  const MQ = matchMedia('(max-width:820px)');
  $$('.events,.guides,.sensors').forEach(p => { p.classList.add('fold'); const h = p.querySelector('.ph'); h.setAttribute('role', 'button'); h.tabIndex = 0;
    h.insertAdjacentHTML('beforeend', '<span class="chev" aria-hidden="true">›</span>');
    const tg = () => { if (MQ.matches) p.classList.toggle('open'); }; h.addEventListener('click', tg); h.addEventListener('keydown', e => { if (e.key === 'Enter') tg(); }); });

  /* ---------- live mode: tap a sensor chip to pair it (Bluetooth for pulse, oxygen, pressure and temperature,
     USB serial for the rest); tap again to unplug. ?ws= and ?api= connect a bridge for every channel at load. ---------- */
  $('#chips').addEventListener('click', async e => {
    const b = e.target.closest('[data-chip]'); if (!b || MODE !== 'live') return;
    const id = b.dataset.chip, c = S.channels[id];
    if (c.status !== 'DISCONNECTED' || c.adapter) { Akari.disconnect(id); return; }
    b.disabled = true;
    try { await Akari.connect(id, AD.BLE_PROFILES[id] ? 'ble' : 'serial'); } finally { b.disabled = false; }
  });
  if (MODE === 'live') {
    const ws = QS.get('ws'), api = QS.get('api');
    const local = (u, p) => { try { const x = new URL(u); return p.includes(x.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname); } catch (_) { return false; } };
    if (ws && local(ws, ['ws:', 'wss:'])) new AD.WebSocketAdapter(ws).connect();
    if (api && local(api, ['http:', 'https:'])) new AD.RestPollingAdapter(api, { interval: Math.max(1000, +QS.get('every') || 5000) }).connect();
    if (QS.get('tbase')) Akari.setBaseline(+QS.get('tbase'));
  }
  if (MODE === 'demo' && URLP && Number.isFinite(URLP.tempBase)) { S.channels.temp.base = URLP.tempBase; S.channels.temp.baseFixed = true; }
  /* a sensor that goes silent must show it: re-evaluate every 5 s when the set of silent channels changes */
  let staleSig = '';
  setInterval(() => { if (!R) return; const x = E.evaluate(S), sig = S.order.filter(id => x.channels[id].stale).join(); if (sig !== staleSig) { staleSig = sig; recompute(); } }, 5000);

  /* ---------- boot ---------- */
  renderProf();
  if (DM) { Akari.ingest(DM.values(), 'SIMULATED', now()); }
  R = E.evaluate(S); prevRules = new Set(); prevEm = false; render();
  Promise.resolve().then(() => { quiet = false; if (MODE === 'live') log('Waiting for sensors.', 'info'); recompute(); });
  raf = requestAnimationFrame(loop);
})(window);
