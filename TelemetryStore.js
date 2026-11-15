/* Akari · TelemetryStore
   Central reactive state (observer pattern) with a short history per channel.
   Classic script: exposes window.TelemetryStore. Channels are SensorChannel objects (SensorAdapters.js). */
(function (g) {
  'use strict';

  /* Nine channels. Blood pressure and pulse are separate; their 20 points from the spec are split 12 + 8.
     Weights add up to 100. */
  const DEFS = [
    { id: 'bp',        name: 'Blood pressure', short: 'Pressure',  unit: 'mmHg',  maxAge: 43200, weight: 12, icon: 'bp',    zone: 'chest',   ble: 0x1810, fields: [['sys', 'Systolic', 60, 200, 1], ['dia', 'Diastolic', 30, 130, 1]], scale: [70, 180], band: [100, 130] },
    { id: 'hr',        name: 'Heart rate',     short: 'Pulse',     unit: 'bpm',   maxAge: 30, weight: 8,  icon: 'heart', zone: 'chest',   ble: 0x180D, min: 30, max: 200, step: 1 },
    { id: 'glucose',   name: 'Blood sugar',    short: 'Sugar',     unit: 'mg/dL', maxAge: 1200, weight: 12, icon: 'drop',  zone: 'abdomen', min: 40, max: 300, step: 1, ring: [40, 220] },
    { id: 'spo2',      name: 'Oxygen',         short: 'Oxygen',    unit: '%',     maxAge: 30, weight: 25, icon: 'o2',    zone: 'chest',   ble: 0x1822, min: 70, max: 100, step: 1, scale: [85, 100], band: [95, 100] },
    { id: 'mood',      name: 'Mood',           short: 'Mood',      unit: 'of 5',  maxAge: 129600, weight: 4,  icon: 'mood',  zone: 'head',    min: 1, max: 5, step: 1, manualFirst: true, ring: [0, 5] },
    { id: 'sleep',     name: 'Sleep',          short: 'Sleep',     unit: 'last night', maxAge: 129600, weight: 15, icon: 'moon', zone: 'head', min: 0, max: 14, step: 0.1, manualFirst: true, ring: [0, 8] },
    { id: 'temp',      name: 'Temperature',    short: 'Temp',      unit: '°C',    maxAge: 600, weight: 10, icon: 'temp',  zone: 'body',    min: 34, max: 42, step: 0.1, scale: [35, 39.5], band: [36.5, 37.6] },
    { id: 'air_co2',   name: 'Cabin air · CO₂', short: 'Cabin CO₂', unit: 'mmHg', maxAge: 600, weight: 8,  icon: 'air',   zone: 'head',    min: 0, max: 8, step: 0.1, scale: [0, 5], band: [0, 2] },
    { id: 'radiation', name: 'Radiation dose', short: 'Radiation', unit: 'mSv',   maxAge: 1800, weight: 6,  icon: 'sun',   zone: 'body',    min: 0, max: 300, step: 0.1, scale: [0, 200], band: [0, 50] }
  ];

  /* maxAge: seconds a LIVE reading stays valid; after that the channel shows "signal lost" and leaves the index.
     Continuous sensors (pulse, oximeter) 30 s; CGM 20 min; cuff readings 12 h; daily inputs 36 h. */

  /* physically possible ranges after unit conversion; anything outside is a sensor fault and is dropped */
  const PLAUS = { hr: [20, 250], glucose: [20, 600], spo2: [50, 100], temp: [25, 45], air_co2: [0, 60] };

  /* names other systems may use */
  const ALIAS = { co2: 'air_co2', pco2: 'air_co2', rad: 'radiation', dose: 'radiation', heart_rate: 'hr', pulse: 'hr', sugar: 'glucose', glu: 'glucose', oxygen: 'spo2', temperature: 'temp', tmp: 'temp', slp: 'sleep', blood_pressure: 'bp' };

  const num = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
  const fin = v => Number.isFinite(v);

  const listeners = {};
  let dirty = new Set(), queued = false;
  const later = typeof queueMicrotask === 'function' ? queueMicrotask : f => Promise.resolve().then(f);

  const TelemetryStore = {
    defs: DEFS,
    order: DEFS.map(d => d.id),
    channels: {},

    init() {
      if (this.ready) return this;
      if (!g.SensorChannel) throw new Error('SensorAdapters.js must load before the store is initialised');
      DEFS.forEach(d => { this.channels[d.id] = new g.SensorChannel(d.id, d.unit, d.weight, d); });
      this.ready = true;
      return this;
    },

    resolve(id) { id = String(id).toLowerCase(); return ALIAS[id] || id; },
    channel(id) { return this.channels[this.resolve(id)] || null; },
    def(id) { return DEFS.find(d => d.id === this.resolve(id)) || null; },

    /* Accepts the usual shapes from devices and APIs and returns the canonical value, or null if unusable. */
    normalize(id, v, prev) {
      if (v == null) return null;
      switch (id) {
        case 'bp': {
          let s, d;
          if (typeof v === 'string') [s, d] = v.split('/').map(num);
          else if (Array.isArray(v)) [s, d] = v.map(num);
          else if (typeof v === 'object') { s = num(v.sys ?? v.systolic ?? v.s); d = num(v.dia ?? v.diastolic ?? v.d); }
          if (!fin(s) || !fin(d) || s <= d || d < 20 || s < 40 || s > 300) return null;
          return { sys: Math.round(s), dia: Math.round(d) };
        }
        case 'radiation': {
          let dose, rate;
          if (typeof v === 'object') { dose = num(v.dose ?? v.cumulative ?? v.dose_cumulative_msv); rate = num(v.rate ?? v.dose_rate_msv_h); }
          else dose = num(v);
          if (!fin(dose) || dose < 0 || dose > 5000) return null;
          if (fin(rate) && (rate < 0 || rate > 1000)) rate = NaN;
          if (!fin(rate)) rate = prev && fin(prev.rate) ? prev.rate : null;
          return { dose, rate };
        }
        case 'sleep': {
          let h, aw;
          if (typeof v === 'object') { h = num(v.hours ?? v.sleep_h ?? v.h); aw = num(v.awake ?? v.hours_awake); }
          else h = num(v);
          if (!fin(h) || h < 0 || h > 24) return null;
          if (fin(aw) && (aw < 0 || aw > 96)) aw = NaN;
          return { hours: h, awake: fin(aw) ? aw : null };
        }
        case 'mood': {
          const n = Math.round(num(v));
          return fin(n) ? Math.min(5, Math.max(1, n)) : null;
        }
        default: {
          let n = num(typeof v === 'object' && v ? v.value : v);
          if (!fin(n)) return null;
          if (id === 'temp' && n > 50) n = Math.round((n - 32) / 1.8 * 100) / 100;        // °F sent by the device
          if (id === 'glucose' && n > 0 && n < 35) n = Math.round(n * 18.016);              // mmol/L
          if (id === 'air_co2' && n > 60) n = Math.round(n / 1316 * 100) / 100;            // ppm at 1 atm
          if (id === 'spo2' && n > 0 && n <= 1) n = n * 100;                                // fraction
          const L = PLAUS[id];
          if (L && (n < L[0] || n > L[1])) return null;
          return n;
        }
      }
    },

    /* batch notifications: many readings in one tick produce one "change" */
    notify(id) {
      dirty.add(id);
      if (queued) return;
      queued = true;
      later(() => { queued = false; const ids = [...dirty]; dirty.clear(); this.emit('change', ids); });
    },

    on(evt, fn) { (listeners[evt] || (listeners[evt] = [])).push(fn); return () => this.off(evt, fn); },
    off(evt, fn) { const l = listeners[evt]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(evt, data) { (listeners[evt] || []).slice().forEach(fn => { try { fn(data); } catch (e) { console.error('[Akari]', e); } }); },

    snapshot() {
      const o = {};
      for (const id of this.order) { const c = this.channels[id]; o[id] = { status: c.status, value: c.value, ts: c.lastTs }; }
      return o;
    }
  };

  g.TelemetryStore = TelemetryStore;
})(window);
