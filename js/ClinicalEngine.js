/* Akari · ClinicalEngine
   Thresholds (spec §2), derived values (MAP, Shock Index, glucose trend), renormalised Health Index and
   Confidence Score (§3) and the five cross-sensor rules (§4). Sources for each threshold are listed in README.
   - CO₂: NASA-STD-3001 Vol. 2 [V2 6004], 1 h average ≤ 3 mmHg; 2.5 mmHg keeps headaches rare (OCHMO-TB-004).
   - Temperature: judged against the crew member's own baseline, because core temperature rises about 1 °C
     at rest over long missions ("space fever", Stahn et al., Sci Rep 2017).
   - Radiation: career effective dose < 600 mSv (NASA-STD-3001 Vol. 1); dose-rate alarm scaled to the
     background of the current environment (LEO, Moon, deep-space transit, Mars surface).
   - Glucose: ADA Standards of Care levels (< 70 and < 54 mg/dL). Blood pressure: ACC/AHA 2017 categories.
   Pure functions over TelemetryStore. Classic script: exposes window.ClinicalEngine.
   Illustrative thresholds for a concept demo; this is not a diagnostic device. */
(function (g) {
  'use strict';
  const RANK = { off: -1, nominal: 0, watch: 1, critical: 2 };
  const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

  /* penalty points per state (spec §2; pressure 20 pts split 12 bp + 8 hr in the same proportion) */
  const PEN = {
    bp: { watch: 4.8, critical: 12 }, hr: { watch: 3.2, critical: 8 }, glucose: { watch: 6, critical: 12 },
    spo2: { watch: 12, critical: 25 }, mood: { watch: 2, critical: 4 }, sleep: { watch: 10, critical: 15 },
    temp: { watch: 5, critical: 10 }, air_co2: { watch: 4, critical: 8 }, radiation: { watch: 3, critical: 6 }
  };
  /* extra points removed when a cross-sensor rule fires (P_synergy) */
  const SYN = { watch: 4, critical: 8 };

  /* mission environment: radiation background (mSv/h, measured by MSL-RAD, Chang'e-4 LND and ISS dosimetry),
     one-way signal delay to Earth and gravity. Selected with ?env= or Akari.setEnv(). */
  const ENV = {
    leo:     { id: 'leo',     label: 'Low Earth orbit', bg: 0.025, delay: 'a few seconds', gravity: 0 },
    lunar:   { id: 'lunar',   label: 'Moon',            bg: 0.057, delay: 'about 1.3 s',   gravity: 0.17 },
    transit: { id: 'transit', label: 'Deep-space transit', bg: 0.075, delay: '3 to 22 min', gravity: 0 },
    mars:    { id: 'mars',    label: 'Mars surface',    bg: 0.027, delay: '3 to 22 min',   gravity: 0.38 }
  };
  let env = ENV.mars;
  function setEnv(k) { if (ENV[k]) env = ENV[k]; return env; }

  const CAREER_MSV = 600, TEMP_BASE = 37.0;
  /* fever limits relative to the personal baseline, with absolute caps: a learned "space fever" baseline can
     never hide a real fever (watch at 38.0 °C at the latest, act at 38.5 °C at the latest) */
  const WATCH_MAX = 38.0, CRIT_MAX = 38.5;
  function tempLimits(base) {
    const b = Number.isFinite(base) ? base : TEMP_BASE;
    return { base: b, watch: Math.min(WATCH_MAX, Math.max(37.9, b + 0.8)), crit: Math.min(CRIT_MAX, Math.max(38.5, b + 1.3)), hyper: 40.0 };
  }
  const rateWatch = () => Math.max(0.05, env.bg * 2);

  /* grade one reading: state + direction ('lo' | 'hi'). ctx: { tempBase, co2Avg } */
  function grade(id, v, ctx) {
    ctx = ctx || {};
    const r = (state, dir) => ({ state, dir: dir || null });
    switch (id) {
      case 'bp': {
        const { sys: s, dia: d } = v;
        if (s >= 180 || d >= 120) return r('critical', 'crisis');
        if (s < 90) return r('critical', 'lo');
        if (s >= 160 || d >= 100) return r('critical', 'hi');
        if (s < 100 || d < 60) return r('watch', 'lo');
        if (s > 130 || d > 85) return r('watch', 'hi');
        return r('nominal');
      }
      case 'hr':
        if (v < 40) return r('critical', 'lo'); if (v > 130) return r('critical', 'hi');
        if (v < 50) return r('watch', 'lo'); if (v > 100) return r('watch', 'hi');
        return r('nominal');
      case 'glucose':
        if (v < 54) return r('critical', 'lo'); if (v >= 250) return r('critical', 'hi');
        if (v < 70) return r('watch', 'lo'); if (v >= 140) return r('watch', 'hi');
        return r('nominal');
      case 'spo2':
        if (v <= 90) return r('critical', 'lo'); if (v < 95) return r('watch', 'lo');
        return r('nominal');
      case 'mood':
        if (v <= 2) return r('critical', 'lo'); if (v === 3) return r('watch', 'lo');
        return r('nominal');
      case 'sleep': {
        const h = v.hours, a = v.awake;
        let s = r('nominal');
        if (h < 5.5) s = r('critical', 'lo'); else if (h > 10.5) s = r('critical', 'hi'); else if (h < 7) s = r('watch', 'lo');
        if (a != null) { if (a > 18) s = r('critical', 'awake'); else if (a >= 16 && RANK[s.state] < 1) s = r('watch', 'awake'); }
        return s;
      }
      case 'temp': {
        const L = tempLimits(ctx.tempBase);
        if (v >= L.hyper) return r('critical', 'hyper');
        if (v >= L.crit) return r('critical', 'hi'); if (v < 35.0) return r('critical', 'lo');
        if (v >= L.watch) return r('watch', 'hi'); if (v < 36.0) return r('watch', 'lo');
        return r('nominal');
      }
      case 'air_co2': {
        const avg = Number.isFinite(ctx.co2Avg) ? ctx.co2Avg : v;
        if (v >= 5 || avg > 3.0) return r('critical', 'hi'); if (v >= 2.5 || avg >= 2.5) return r('watch', 'hi');
        return r('nominal');
      }
      case 'radiation': {
        const rate = v.rate ?? 0;
        if (rate > 0.5) return r('critical', 'rate');
        if (v.dose >= CAREER_MSV * 0.8) return r('critical', 'hi');
        if (rate >= rateWatch()) return r('watch', 'rate');
        if (v.dose >= 100) return r('watch', 'hi');
        return r('nominal');
      }
    }
    return r('nominal');
  }

  /* plain-language line for each state, for a non-specialist */
  const SAY = {
    bp: { ok: 'Normal', lo: 'A bit low. Sit down and drink water', hi: 'A bit high. Rest 5 min and read again', clo: 'Too low. Lie down and call your crewmate', chi: 'Too high. Rest and call your crewmate', ccrisis: 'Very high. Stop, sit still and call the flight surgeon' },
    hr: { ok: 'Normal', lo: 'A bit slow. Fine if you are fit and resting', hi: 'A bit fast. Expected during exercise; at rest, breathe slowly', clo: 'Very slow. Call your crewmate', chi: 'Very fast. Stop and follow the steps' },
    glucose: { ok: 'In range', lo: 'Low. Take 15 g of fast sugar, read again in 15 min', hi: 'A bit high. Drink water, check again in 30 min', clo: 'Too low. Take sugar now and tell your crewmate', chi: 'Too high. Call your crewmate' },
    spo2: { ok: 'Normal', lo: 'A bit low. Breathe slowly and deeply', clo: 'Too low. Put on the oxygen mask' },
    mood: { ok: 'Good', lo: 'A bit low. A short break may help', clo: 'Very low. Talk to your crewmate' },
    sleep: { ok: 'Well rested', lo: 'Short night. Plan a rest today', clo: 'Very little sleep. Avoid critical tasks', chi: 'Slept very long. Tell your crewmate', awake: 'Awake a long time. Plan sleep soon', cawake: 'Awake too long. Sleep before any critical task' },
    temp: { ok: 'Normal for you', lo: 'Slightly cool. Put on a warm layer', hi: 'Above your usual. If you just exercised, rest 30 min and read again', clo: 'Too cold. Call your crewmate', chi: 'Fever above your space baseline. Rest and call your crewmate', chyper: 'Overheating. Stop, cool down now and call your crewmate' },
    air_co2: { ok: 'Fresh air', hi: 'Air a bit stale. Raise the airflow', chi: 'Above the NASA limit. Check the CO₂ scrubber' },
    radiation: { ok: 'Within the mission limit', hi: 'Dose building up. Limit time near the hull', chi: 'Close to the career limit. Tell the flight surgeon', rate: 'Dose rate above background. Stay near shielding', crate: 'Solar storm. Go to the shielded area now' }
  };
  function say(id, gr) {
    const t = SAY[id];
    if (gr.state === 'nominal') return t.ok;
    const k = gr.dir || 'hi';
    return gr.state === 'critical' ? t['c' + k] || t[k] || 'Needs attention now' : t[k] || 'Keep an eye on it';
  }

  /* glucose trend from the last readings (spec §2.2): mg/dL per minute against the reading about 10 min earlier */
  function glucoseTrend(hist) {
    if (!hist || hist.length < 3) return null;
    const a = hist[hist.length - 1];
    let b = null;
    for (let i = hist.length - 2; i >= 0; i--) {
      const dt = (a.timestamp - hist[i].timestamp) / 60000;
      if (dt > 15) break;
      b = hist[i];
      if (dt >= 10) break;
    }
    if (!b) return null;
    const dt = (a.timestamp - b.timestamp) / 60000;
    if (dt < 2) return null;
    const rate = (a.value - b.value) / dt;
    const arrow = rate > 2 ? '↑' : rate > 1 ? '↗' : rate >= -1 ? '→' : rate >= -2 ? '↘' : '↓';
    const word = rate > 2 ? 'rising fast' : rate > 1 ? 'rising' : rate >= -1 ? 'steady' : rate >= -2 ? 'falling' : 'falling fast';
    return { rate: Math.round(rate * 100) / 100, arrow, word };
  }

  /* the five cross-sensor rules (§4); a rule is only evaluated when all its sensors are connected */
  const RULES = [
    { id: 'HYPOXIA_ACUTE', needs: ['spo2', 'hr'], level: 'critical', zone: 'chest', emergency: true,
      test: v => v.spo2 <= 90 || (v.spo2 <= 93 && v.hr > 120),
      title: 'Low oxygen', text: v => `Oxygen is ${Math.round(v.spo2)} % and your pulse is ${Math.round(v.hr)}. Your brain may be short of oxygen before you feel it.` },
    { id: 'SEPSIS_EARLY', needs: ['temp', 'hr', 'bp'], level: 'critical', zone: 'chest',
      test: (v, x) => (v.temp >= tempLimits(x.tempBase).watch || v.temp < 36.0) && (v.hr / v.bp.sys > 0.9 || (v.hr > 90 && v.bp.sys <= 100)),
      title: 'Fever with a fast pulse', titleOf: v => (v.temp < 36.0 ? 'Low temperature with a fast pulse' : 'Fever with a fast pulse'), text: (v, x) => `Temperature ${v.temp.toFixed(1)} °C (your usual is ${tempLimits(x.tempBase).base.toFixed(1)} °C) and a pulse that is high for your blood pressure. This can be an early infection.` },
    { id: 'SANS_RISK', needs: ['air_co2', 'bp'], level: 'watch', zone: 'head',
      test: v => v.air_co2 >= 2.5 && v.bp.sys >= 130,
      title: 'Stale air and high pressure: protect your eyes', text: v => `Cabin CO₂ is ${v.air_co2.toFixed(1)} mmHg and blood pressure ${v.bp.sys}/${v.bp.dia}. Together they raise pressure behind the eyes.` },
    { id: 'METABOLIC_STRESS', needs: ['sleep', 'glucose'], level: 'watch', zone: 'abdomen',
      test: v => v.sleep.hours < 6.0 && v.glucose >= 110,
      title: 'Short sleep is raising your blood sugar', text: v => `You slept ${hm(v.sleep.hours)} and blood sugar is ${Math.round(v.glucose)} mg/dL. A short night makes the body handle sugar less well.` },
    { id: 'RAD_IMMUNE', needs: ['radiation', 'temp'], level: 'watch', zone: 'body',
      test: (v, x) => (v.radiation.dose >= 100 || (v.radiation.rate ?? 0) >= rateWatch()) && v.temp >= tempLimits(x.tempBase).base + 0.6,
      title: 'Radiation dose with a slight fever', text: v => `Total dose ${v.radiation.dose.toFixed(1)} mSv and temperature ${v.temp.toFixed(1)} °C. The body's defences may be lowered.` }
  ];

  function hm(h) { const H = Math.floor(h), M = Math.round((h - H) * 60); return M === 60 ? `${H + 1} h 00` : `${H} h ${String(M).padStart(2, '0')}`; }

  /* mean of the readings in the last hour (the NASA CO₂ limit is a 1 h average) */
  function hourAvg(hist) {
    if (!hist || !hist.length) return null;
    const t = hist[hist.length - 1].timestamp, a = hist.filter(h => t - h.timestamp <= 3600e3 && Number.isFinite(h.value));
    return a.length >= 5 ? a.reduce((s, h) => s + h.value, 0) / a.length : null;
  }
  const ago = ms => (ms < 120e3 ? `${Math.round(ms / 1000)} s` : ms < 7200e3 ? `${Math.round(ms / 60e3)} min` : `${Math.round(ms / 3600e3)} h`);

  function evaluate(store) {
    const ch = {}, vals = {}, wall = Date.now();
    const ctx = { tempBase: store.channels.temp && store.channels.temp.base, co2Avg: store.channels.air_co2 ? hourAvg(store.channels.air_co2.history) : null };
    let Wd = 0, P = 0, n = 0;
    for (const d of store.defs) {
      const c = store.channels[d.id], v = c.value;
      if (c.status === 'DISCONNECTED' || v == null) {
        ch[d.id] = { id: d.id, active: false, state: 'off', status: c.status, penalty: 0, text: d.manualFirst ? 'Manual input' : 'Awaiting sensor' };
        continue;
      }
      /* a live sensor that stopped sending is not trusted: it leaves the index until it sends again */
      const age = c.lastRecv ? wall - c.lastRecv : 0;
      if (c.status === 'LIVE' && d.maxAge && age > d.maxAge * 1000) {
        ch[d.id] = { id: d.id, active: false, stale: true, state: 'off', status: c.status, penalty: 0, value: v, text: `Signal lost · last reading ${ago(age)} ago` };
        continue;
      }
      const gr = grade(d.id, v, ctx), pen = gr.state === 'nominal' ? 0 : PEN[d.id][gr.state];
      Wd += d.weight; P += pen; n++;
      vals[d.id] = v;
      ch[d.id] = { id: d.id, active: true, state: gr.state, dir: gr.dir, status: c.status, penalty: pen, value: v, text: say(d.id, gr) };
    }

    const derived = {};
    const alerts = [];
    if (vals.bp) {
      derived.map = Math.round(vals.bp.dia + (vals.bp.sys - vals.bp.dia) / 3);
      if (derived.map < 65) alerts.push({ id: 'MAP_LOW', level: 'critical', zone: 'chest', title: 'Low blood flow to the brain', text: `Mean pressure is ${derived.map} mmHg. Lie down and call your crewmate.` });
    }
    if (vals.bp && vals.hr != null) {
      derived.si = Math.round(vals.hr / vals.bp.sys * 100) / 100;
      if (derived.si > 0.9) alerts.push({ id: 'SHOCK_INDEX', level: 'watch', zone: 'chest', title: 'Pulse is high for your blood pressure', text: `Shock index ${derived.si.toFixed(2)} (healthy is 0.5 to 0.7). Rest and drink water.` });
    }
    if (vals.glucose != null) {
      derived.trend = glucoseTrend(store.channels.glucose.history.filter(h => h.source !== 'DISCONNECTED'));
      if (derived.trend && derived.trend.rate < -2) alerts.push({ id: 'GLUCOSE_FALLING', level: 'watch', zone: 'abdomen', title: 'Blood sugar falling fast', text: `Dropping ${Math.abs(derived.trend.rate).toFixed(1)} mg/dL per minute. Have a snack now, even if the number still looks fine.` });
    }

    const rules = [];
    let Psyn = 0;
    for (const R of RULES) {
      if (!R.needs.every(k => vals[k] != null)) continue;
      if (!R.test(vals, ctx)) continue;
      rules.push({ id: R.id, level: R.level, zone: R.zone, emergency: !!R.emergency, title: R.titleOf ? R.titleOf(vals) : R.title, text: R.text(vals, ctx), needs: R.needs });
      Psyn += SYN[R.level];
    }

    const confidence = Math.round(Wd);
    const healthIndex = Wd > 0 ? Math.max(0, Math.round(100 - (P / Wd) * 100 - Psyn)) : null;

    /* body zones to light: worst of their channels, the rules and the derived alerts */
    const zones = { head: 'nominal', chest: 'nominal', abdomen: 'nominal', body: 'nominal' };
    for (const d of store.defs) { const s = ch[d.id].state; if (s !== 'off') zones[d.zone] = worst(zones[d.zone], s); }
    rules.forEach(r => { zones[r.zone] = worst(zones[r.zone], r.level); });
    alerts.forEach(a => { zones[a.zone] = worst(zones[a.zone], a.level); });

    if (ch.temp.active && ch.temp.dir === 'hyper') alerts.push({ id: 'HYPERTHERMIA', level: 'critical', zone: 'body', title: 'Body overheating', text: `Core temperature ${vals.temp.toFixed(1)} °C. Stop all effort, raise cooling and call your crewmate.` });
    if (ch.bp.active && ch.bp.dir === 'crisis') alerts.push({ id: 'BP_CRISIS', level: 'critical', zone: 'chest', title: 'Very high blood pressure', text: `${vals.bp.sys}/${vals.bp.dia} mmHg. Sit still, read again in 5 min and call the flight surgeon.` });

    const emergency = rules.some(r => r.emergency) || (ch.spo2.active && ch.spo2.state === 'critical');

    /* everything that needs attention, most severe first: rules, derived alerts, then single readings */
    const items = [
      ...rules.map(r => ({ kind: 'rule', id: r.id, level: r.level, title: r.title, text: r.text })),
      ...alerts.map(a => ({ kind: 'alert', id: a.id, level: a.level, title: a.title, text: a.text })),
      ...store.defs.filter(d => ch[d.id].active && ch[d.id].state !== 'nominal').map(d => ({ kind: 'channel', id: d.id, level: ch[d.id].state, title: d.name, text: ch[d.id].text }))
    ].sort((a, b) => RANK[b.level] - RANK[a.level]);

    let level = 'nominal';
    items.forEach(i => { level = worst(level, i.level); });
    let headline;
    if (!n) headline = 'Waiting for sensors';
    else if (emergency) headline = 'Emergency · low oxygen';
    else if (rules.length) headline = rules[0].title;
    else if (items.length) headline = items.length === 1 ? 'One thing to look at' : `${items.length} things to look at`;
    else headline = 'All systems nominal';
    const label = healthIndex == null ? 'No data' : emergency ? 'Critical' : healthIndex >= 85 ? 'Stable' : healthIndex >= 60 ? 'Watch' : 'Act now';

    return { ts: Date.now(), channels: ch, derived, rules, alerts, items, zones, emergency, level, headline, label,
      healthIndex, confidence, active: n, total: store.defs.length, weightActive: Wd, penalty: P, synergy: Psyn,
      env, limits: { temp: tempLimits(ctx.tempBase), co2Avg: ctx.co2Avg, rateWatch: rateWatch(), career: CAREER_MSV } };
  }

  g.ClinicalEngine = { evaluate, grade, say, glucoseTrend, tempLimits, setEnv, ENV, get env() { return env; }, RULES, PEN, SYN, hm, CAREER_MSV };
})(window);
