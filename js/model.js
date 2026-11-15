/* Akari · physiological model used by the internal demo and the internal test tool.
   Circadian swing and soft noise, pulse that follows effort, glucose with meals, cumulative radiation.
   Scenario offsets ramp in over ~2 s of real time and add on top of the profile baseline.
   Classic script: exposes window.AkariModel. */
(function (g) {
  'use strict';
  const TAU = Math.PI * 2;
  const IDS = ['bp', 'hr', 'glucose', 'spo2', 'mood', 'sleep', 'temp', 'air_co2', 'radiation'];
  const HEALTHY = { hr: 63, sys: 117, dia: 77, glucose: 94, spo2: 98, mood: 4, sleep: 7.67, temp: 37.05, co2: 1.8, dose: 40, rate: 0.02 };
  const SCEN = {
    profile:  { label: 'Profile case', tgt: {} },
    nominal:  { label: 'Nominal', tgt: {}, healthy: true },
    routine:  { label: 'Daily routine', tgt: {}, enter(m) { m.exUntil = m.t + 25 * 60e3; m.meals.push(m.t); } },
    poorsleep:{ label: 'Poor sleep', tgt: { sleep: -2.45, gb: 30, hr: 6, awake: 7 }, rule: 'METABOLIC_STRESS' },
    highco2:  { label: 'High CO₂', tgt: { co2: 1.1, sys: 18, dia: 7 }, rule: 'SANS_RISK' },
    fever:    { label: 'Fever', tgt: { temp: 1.55, hr: 52, sys: -9, mood: -1 }, rule: 'SEPSIS_EARLY' },
    storm:    { label: 'Solar storm', tgt: { rate: 0.9, temp: 0.72 }, rule: 'RAD_IMMUNE' }
  };
  const HYP = { spo2: -12.5, hr: 66, co2: 0.4 };
  const KEYS = ['co2', 'mood', 'sleep', 'gb', 'hr', 'awake', 'sys', 'dia', 'temp', 'rate', 'spo2'];
  const noise = s => (Math.random() + Math.random() + Math.random() - 1.5) * s;
  const r1 = v => Math.round(v * 10) / 10;

  function create(P) {
    const m = { P, speed: 60, scen: 'profile', hyp: false, off: {}, ov: {}, ex: 0, exUntil: 0, lastH: null, v: null };
    m.reset = function (prof) {
      if (prof) m.P = prof;
      m.t = (m.P.sol * 86400 + 7 * 3600 + 31 * 60) * 1000;
      m.g = m.P.base.glucose; m.dose = m.P.base.dose; m.meals = [m.t - 31 * 60e3]; m.off = {}; m.ov = {}; m.lastH = null;
    };
    m.setScenario = function (k) {
      if (!SCEN[k]) return;
      m.scen = k;
      const B = SCEN[k].healthy ? HEALTHY : m.P.base;
      if (k === 'profile' || k === 'nominal') { m.dose = B.dose; m.ov = {}; }
      if (SCEN[k].enter) SCEN[k].enter(m);
      for (let i = 0; i < 5; i++) m.step(0.5);
    };
    m.step = function (dtReal) {
      const B = SCEN[m.scen].healthy ? HEALTHY : m.P.base, A = m.P.amp || {};
      const dts = dtReal * m.speed, dtm = dts / 60;
      m.t += dts * 1000;
      const h = (m.t / 3600e3) % 24, circ = Math.sin(TAU * (h - 10) / 24);
      const tgt = Object.assign({}, SCEN[m.scen].tgt);
      if (m.hyp) for (const k in HYP) tgt[k] = (tgt[k] || 0) + HYP[k];
      const kk = 1 - Math.exp(-dtReal / 0.9);
      KEYS.forEach(k => { const o = m.off[k] || 0; m.off[k] = o + ((tgt[k] || 0) - o) * kk; });
      const O = m.off;
      if (m.lastH != null) [7, 12.5, 19].forEach(x => { if ((m.lastH < x && h >= x) || (m.lastH > h && x <= h)) m.meals.push(m.t - (h - x) * 3600e3); });
      m.lastH = h;
      m.meals = m.meals.filter(x => m.t - x < 4 * 3600e3);
      const work = m.t < m.exUntil || (SCEN[m.scen].healthy ? [10, 17] : m.P.exercise || []).some(x => h >= x && h < x + 0.5);
      m.ex += ((work ? 0.75 : 0) - m.ex) * (1 - Math.exp(-dtm / 3));
      const ex = m.ex, v = {};
      v.hr = B.hr + (A.hr || 3) * circ + ex * 55 + O.hr + noise(1.1);
      v.sys = B.sys + (A.sys || 3) * circ + ex * 16 + O.sys + noise(1); v.dia = B.dia + 1.5 * circ + ex * 5 + O.dia + noise(0.7);
      v.temp = B.temp + (A.temp || 0.1) * circ + ex * 0.3 + O.temp + noise(0.025);
      v.spo2 = Math.min(100, B.spo2 + O.spo2 - ex * 0.4 + noise(0.35));
      v.co2 = Math.max(0.3, B.co2 + (A.co2 || 0.1) * circ + O.co2 + noise(0.03));
      let meal = 0; m.meals.forEach(x => { const y = (m.t - x) / 60e3 / 40; if (y > 0) meal += 28 * y * Math.exp(1 - y); });
      const gT = B.glucose + O.gb + meal - ex * 18;
      m.g += (gT - m.g) * (1 - Math.exp(-dtm / 15)) + noise(0.5) * Math.min(1, dtm);
      v.glucose = m.g;
      v.rate = Math.max(0.005, B.rate + O.rate + noise(0.002));
      m.dose += v.rate * dts / 3600;
      v.mood = Math.max(1, Math.min(5, Math.round(B.mood + O.mood)));
      v.sleep = Math.max(2, B.sleep + O.sleep);
      v.awake = ((h - 7 + 24) % 24) + O.awake;
      m.v = v;
      return v;
    };
    /* canonical readings; pinned overrides (m.ov) win over the model */
    m.values = function () {
      const v = m.v || m.step(0), ov = m.ov, pick = (id, x) => (ov[id] != null ? ov[id] : x);
      if (ov.radiation != null) m.dose = ov.radiation;
      const sys = Math.round(pick('bp', v.sys)), dia = Math.round(ov.bp != null ? ov.bp - 40 : v.dia);
      return {
        bp: { sys, dia: Math.min(dia, sys - 15) }, hr: Math.round(pick('hr', v.hr)), glucose: Math.round(pick('glucose', v.glucose)),
        spo2: Math.round(pick('spo2', v.spo2)), mood: Math.round(pick('mood', v.mood)), sleep: { hours: Math.round(pick('sleep', v.sleep) * 100) / 100, awake: r1(v.awake) },
        temp: r1(pick('temp', v.temp)), air_co2: r1(pick('air_co2', v.co2)),
        radiation: { dose: Math.round(m.dose * 10) / 10, rate: Math.round(v.rate * 1000) / 1000 }
      };
    };
    m.reset(P);
    return m;
  }
  g.AkariModel = { create, SCEN, HYP, IDS };
})(window);
