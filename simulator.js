/* Akari · simulator (internal, NOT part of the public build)
   Lives only in simulador.html. Drives an index.html tab of the same browser over BroadcastChannel('akari').
   BroadcastChannel never leaves the browser: it does not reach another device. */
(function (g) {
  'use strict';
  const $ = s => document.querySelector(s);
  const M = g.AkariModel, PR = g.AKARI_PROFILES, IDS = M.IDS;
  const NAMES = { bp: 'Presión arterial', hr: 'Pulso', glucose: 'Azúcar en sangre', spo2: 'Oxígeno en sangre', mood: 'Ánimo', sleep: 'Sueño', temp: 'Temperatura', air_co2: 'CO₂ de la cabina', radiation: 'Radiación' };
  const EN = { bp: 'Blood pressure', hr: 'Heart rate', glucose: 'Blood sugar', spo2: 'Oxygen', mood: 'Mood', sleep: 'Sleep', temp: 'Temperature', air_co2: 'Cabin CO₂', radiation: 'Radiation' };
  const GROUPS = [['Corazón y respiración', ['hr', 'bp', 'spo2']], ['Cuerpo', ['temp', 'glucose']], ['Descanso y ánimo', ['sleep', 'mood']], ['Entorno', ['air_co2', 'radiation']]];
  const SC_ES = { profile: ['Caso del perfil', 'Los valores propios de este tripulante.', ''], nominal: ['Todo normal', 'Todos los signos en verde.', 'ok'], routine: ['Rutina diaria', 'Ejercicio y comida; abre el chequeo diario.', ''], poorsleep: ['Mal sueño', 'Pocas horas de sueño y azúcar alta.', 'watch'], highco2: ['CO₂ alto', 'Aire viciado y presión alta.', 'watch'], fever: ['Fiebre', 'Temperatura alta con pulso rápido.', 'crit'], storm: ['Tormenta solar', 'Sube la dosis de radiación (DONKI).', 'watch'] };
  const UNIT = { bp: 'mmHg', hr: 'bpm', glucose: 'mg/dL', spo2: '%', mood: 'de 5', sleep: 'h', temp: '°C', air_co2: 'mmHg', radiation: 'mSv' };
  const RANGE = { bp: [80, 180, 1], hr: [40, 180, 1], glucose: [50, 260, 1], spo2: [75, 100, 1], mood: [1, 5, 1], sleep: [3, 11, .1], temp: [35, 40, .1], air_co2: [.5, 6, .1], radiation: [0, 200, .1] };

  let bc = null, model = null, prof = null, paused = false, on = {}, manual = new Set(), timer = 0, lr = 0;
  const post = m => { if (bc) try { bc.postMessage(Object.assign({ from: 'sim' }, m)); } catch (e) {} };
  const clone = o => JSON.parse(JSON.stringify(o));

  function gate() { start(); }

  function sendProfile() { post({ type: 'profile', profile: prof }); }
  function loadProfile(id) {
    prof = clone(PR[id]); model.reset(prof); model.setScenario('profile');
    document.querySelectorAll('[data-pf]').forEach(i => { const k = i.dataset.pf; i.value = k === 'conds' ? prof.conds.join(', ') : prof[k]; });
    $('#pstory').textContent = prof.story;
    markScen(); sendProfile(); post({ type: 'log', text: `Simulator profile: ${prof.name} · ${prof.story}` });
  }
  function markScen() { document.querySelectorAll('[data-sc]').forEach(b => b.classList.toggle('on', b.dataset.sc === model.scen)); document.querySelectorAll('.r').forEach(r => { if (model.ov[r.dataset.ov] == null && !manual.has(r.dataset.ov)) r.dataset.auto = '1'; }); }

  function tick() {
    const t = performance.now(), dt = Math.min(2, (t - lr) / 1000); lr = t;
    if (paused) { post({ type: 'beat' }); return; }
    model.step(dt);
    const all = model.values(), out = {};
    IDS.forEach(id => { if (on[id] && !manual.has(id)) out[id] = all[id]; });
    post({ type: 'clock', ts: model.t });
    if (Object.keys(out).length) post({ type: 'ingest', values: out, source: 'SIMULATED', ts: model.t });
    paint(all);
  }
  function paint(all) {
    IDS.forEach(id => {
      const v = all[id], x = id === 'bp' ? v.sys : id === 'sleep' ? v.hours : id === 'radiation' ? v.dose : v;
      const o = document.querySelector(`[data-o="${id}"]`), rg = document.querySelector(`[data-rg="${id}"]`);
      o.textContent = !on[id] ? 'apagado' : manual.has(id) ? 'manual' : id === 'bp' ? `${v.sys}/${v.dia}` : String(x);
      if (document.activeElement !== rg && model.ov[id] == null) rg.value = x;
    });
  }

  function build() {
    $('#psel').innerHTML = Object.values(PR).map(p => `<option value="${p.id}">${p.id} · ${p.name}, ${p.age} · ${p.conds[0] || 'sano'}</option>`).join('');
    $('#scen').innerHTML = Object.keys(M.SCEN).map(k => { const e = SC_ES[k] || [M.SCEN[k].label, '', '']; return `<button type="button" data-sc="${k}" data-k="${e[2]}"><b>${e[0]}</b><small>${e[1]}</small></button>`; }).join('') + '<button type="button" id="hyp" data-k="crit" aria-pressed="false"><b>Emergencia: hipoxia</b><small>Baja el oxígeno encima del escenario. Otro clic la quita.</small></button>';
    $('#speed').innerHTML = [[1, '1×'], [60, '60×'], [600, '600×']].map(([v, l]) => `<button type="button" class="b ${v === 60 ? 'on' : ''}" data-sp="${v}">${l}</button>`).join('');
    $('#rows').innerHTML = GROUPS.map(([gn, ids]) => `<div class="grp"><span class="lab">${gn}</span>${ids.map(id => { const [a, b, sp] = RANGE[id]; return `<div class="r" data-ov="${id}" data-auto="1"><input type="checkbox" class="sw" data-sw="${id}" checked aria-label="${NAMES[id]} conectado"><span class="nm">${NAMES[id]}<small>${UNIT[id]}</small></span><input type="range" min="${a}" max="${b}" step="${sp}" data-rg="${id}" aria-label="Valor de ${NAMES[id]}"><output data-o="${id}"></output><button type="button" class="b" data-auto="${id}">Auto</button></div>`; }).join('')}</div>`).join('');
    $('#camCh').innerHTML = IDS.map(id => `<option value="${id}">${NAMES[id]}</option>`).join('');
    $('#psel').onchange = e => loadProfile(e.target.value);
    $('#openApp').onclick = () => window.open(`index.html?profile=${$('#psel').value}`, '_blank');
    document.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.sc) { model.setScenario(b.dataset.sc); markScen(); post({ type: 'log', text: `Scenario: ${M.SCEN[b.dataset.sc].label}` }); if (b.dataset.sc === 'routine') post({ type: 'guide', key: 'daily' }); }
      if (b.dataset.sp) { model.speed = +b.dataset.sp; document.querySelectorAll('[data-sp]').forEach(x => x.classList.toggle('on', x === b)); }
      if (b.dataset.auto) { const id = b.dataset.auto; delete model.ov[id]; manual.delete(id); b.closest('.r').dataset.auto = '1'; }
    });
    $('#pause').onclick = e => { paused = !paused; e.target.textContent = paused ? 'Reanudar' : 'Pausar'; e.target.classList.toggle('on', paused); post({ type: 'log', text: paused ? 'Simulator paused' : 'Simulator resumed' }); };
    $('#hyp').onclick = e => { const hb = e.currentTarget; model.hyp = !model.hyp; hb.classList.toggle('on', model.hyp); hb.setAttribute('aria-pressed', model.hyp); post({ type: 'log', text: model.hyp ? 'Hypoxia applied' : 'Hypoxia removed' }); };
    $('#rows').addEventListener('input', e => { const id = e.target.dataset.rg; if (!id) return; model.ov[id] = +e.target.value; manual.delete(id); e.target.closest('.r').dataset.auto = '0'; });
    $('#rows').addEventListener('change', e => { const id = e.target.dataset.sw; if (!id) return; on[id] = e.target.checked; if (!on[id]) post({ type: 'disconnect', id }); });
    document.querySelectorAll('[data-pf]').forEach(i => i.addEventListener('input', () => {
      const k = i.dataset.pf; prof[k] = k === 'conds' ? i.value.split(',').map(x => x.trim()).filter(Boolean) : i.value; sendProfile(); }));
    $('#camGo').onclick = () => {
      const id = $('#camCh').value, all = model.values();
      g.OpticalScanner.open($('#camHost'), { id, name: NAMES[id], unit: UNIT[id] }, () => (id === 'sleep' ? all.sleep.hours : id === 'radiation' ? all.radiation.dose : all[id]), v => {
        manual.add(id); const val = id === 'radiation' ? { dose: v } : v;
        post({ type: 'ingest', values: { [id]: val }, source: 'MANUAL', ts: model.t });
        post({ type: 'log', text: `${EN[id]} entered with the camera (simulated reading)` });
        document.querySelector(`.r[data-ov="${id}"]`).dataset.auto = '0'; $('#camHost').innerHTML = '<p class="note">Valor enviado como manual. Pulse «Auto» en ese sensor para devolverlo al modelo.</p>';
      });
    };
  }

  function start() {
    $('#gate').hidden = true; $('#sim').hidden = false;
    IDS.forEach(id => (on[id] = true));
    try { bc = new BroadcastChannel('akari'); } catch (e) { $('#appState').textContent = 'Este navegador no tiene BroadcastChannel: el simulador no llega a la app.'; }
    model = M.create(clone(PR.p1));
    build();
    const q = new URLSearchParams(location.search).get('profile');
    $('#psel').value = PR[q] ? q : 'p1'; loadProfile($('#psel').value);
    if (bc) bc.onmessage = e => { const m = e.data || {};
      if (m.type === 'app') { post({ type: 'hello' }); sendProfile(); }
      if (m.type === 'state') { const a = $('#appState'); a.classList.add('ok'); a.textContent = `App conectada · índice ${m.healthIndex ?? '—'} · alertas: ${m.rules.join(', ') || 'ninguna'}`; } };
    post({ type: 'hello' });
    addEventListener('beforeunload', () => post({ type: 'bye' }));
    lr = performance.now(); timer = setInterval(tick, 1000); tick();
  }

  document.addEventListener('DOMContentLoaded', gate);
})(window);
