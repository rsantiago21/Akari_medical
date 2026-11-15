/* Akari · SensorAdapters
   SensorChannel: the single contract every data source uses (pushReading / disconnect).
   Adapters (ready, disconnected by default): Web Bluetooth (Heart Rate 0x180D, Pulse Oximeter 0x1822,
   Blood Pressure 0x1810), Web Serial, REST polling and WebSocket. All of them end in pushReading(value, 'LIVE').
   Classic script: exposes window.SensorChannel and window.SensorAdapters. */
(function (g) {
  'use strict';
  const STATUSES = ['DISCONNECTED', 'SIMULATED', 'MANUAL', 'LIVE'];

  class SensorChannel {
    constructor(id, unit, weight, def) {
      this.id = id;                 // 'glucose', 'spo2', 'air_co2', ...
      this.unit = unit;             // 'mg/dL', '%', 'mmHg', ...
      this.weight = weight;         // clinical weight in the Health Index
      this.def = def || {};
      this.status = 'DISCONNECTED'; // 'DISCONNECTED' | 'SIMULATED' | 'MANUAL' | 'LIVE'
      this.history = [];            // last 50 readings [{ value, timestamp, source }]
      this.adapter = null;          // adapter currently feeding this channel, if any
      this.lastRecv = null;         // wall-clock time of the last reading (used to detect a silent sensor)
      this.base = null;             // personal baseline (temperature only), see pushReading
    }
    get value() { return this.status === 'DISCONNECTED' || !this.history.length ? null : this.history[this.history.length - 1].value; }
    get lastTs() { return this.history.length ? this.history[this.history.length - 1].timestamp : null; }

    /* Single entry point for BLE, Serial, API, camera, manual or simulator. ts is optional (the simulator passes mission time). */
    pushReading(value, source = 'LIVE', ts) {
      if (!STATUSES.includes(source) || source === 'DISCONNECTED') source = 'LIVE';
      const prev = this.history.length ? this.history[this.history.length - 1].value : null;
      const v = g.TelemetryStore.normalize(this.id, value, prev);
      if (v == null) return false;
      const was = this.status;
      this.status = source;
      const t = Number.isFinite(ts) ? ts : Date.now(), lt = this.lastTs;
      this.history.push({ value: v, timestamp: t, source });
      if (this.history.length > 50) this.history.shift();
      this.lastRecv = Date.now();
      /* temperature baseline: slow average (time constant 12 h) of afebrile readings, so the in-flight rise of
         about 1 °C ("space fever") is learned and only a rise above the person's own normal counts as fever */
      if (this.id === 'temp' && !this.baseFixed && v >= 36.0 && v < 37.9) {
        if (this.base == null) this.base = Math.min(37.6, Math.max(36.6, v));
        else if (lt != null && t > lt) { const k = 1 - Math.exp(-(t - lt) / 43200e3); this.base = Math.min(37.6, Math.max(36.6, this.base + (v - this.base) * k)); }
      }
      if (was !== source) g.TelemetryStore.emit('status', { id: this.id, status: source, was });
      g.TelemetryStore.notify(this.id);   // recomputes the Health Index and the UI
      return true;
    }

    disconnect() {
      const a = this.adapter; this.adapter = null;
      if (a) { try { a.release(this.id); } catch (e) { /* the device may already be gone */ } }
      if (this.status === 'DISCONNECTED') return;
      const was = this.status;
      this.status = 'DISCONNECTED';
      g.TelemetryStore.emit('status', { id: this.id, status: 'DISCONNECTED', was });
      g.TelemetryStore.notify(this.id);   // the engine renormalises the weights
    }
  }

  /* ---------- object ingestion shared by adapters and window.Akari.ingest ---------- */
  function ingest(obj, source = 'LIVE', ts) {
    const S = g.TelemetryStore, done = [];
    if (!obj || typeof obj !== 'object') return done;
    const o = Object.assign({}, obj);
    // flat forms: bp_sys / bp_dia, rad_rate, sleep_awake
    const sys = o.bp_sys ?? o.systolic, dia = o.bp_dia ?? o.diastolic;
    if (sys != null && dia != null && o.bp == null) o.bp = { sys, dia };
    if (o.rad_rate != null || o.dose_rate_msv_h != null) {
      const r = o.rad_rate ?? o.dose_rate_msv_h, base = o.radiation ?? o.dose_cumulative_msv;
      o.radiation = typeof base === 'object' && base ? Object.assign({}, base, { rate: r }) : { dose: base ?? (S.channel('radiation').value || {}).dose, rate: r };
    }
    if (o.sleep_awake != null || o.hours_awake != null) o.sleep = { hours: typeof o.sleep === 'object' ? o.sleep.hours : o.sleep ?? (S.channel('sleep').value || {}).hours, awake: o.sleep_awake ?? o.hours_awake };
    ['bp_sys', 'bp_dia', 'systolic', 'diastolic', 'rad_rate', 'dose_rate_msv_h', 'dose_cumulative_msv', 'sleep_awake', 'hours_awake'].forEach(k => delete o[k]);
    for (const k in o) {
      const c = S.channel(k);
      if (c && o[k] != null && c.pushReading(o[k], source, ts)) done.push(c.id);
    }
    return done;
  }

  /* ---------- base adapter ---------- */
  class BaseAdapter {
    constructor(kind, channels, opts) {
      this.kind = kind; this.channels = channels; this.opts = opts || {};
      this.state = 'idle'; this.error = null; this.onstate = null;
    }
    get supported() { return true; }
    setState(s, err) { this.state = s; this.error = err || null; if (this.onstate) this.onstate(s, err); g.TelemetryStore && g.TelemetryStore.emit('adapter', { kind: this.kind, state: s, error: err ? String(err.message || err) : null, channels: this.channels }); }
    attach() { this.channels.forEach(id => { const c = g.TelemetryStore.channel(id); if (c) { if (c.adapter && c.adapter !== this) c.adapter.release(id); c.adapter = this; } }); }
    push(obj) { return ingest(obj, 'LIVE'); }
    /* called when one channel is disconnected from the UI; closes the device once no channel uses it */
    release(id) { this.channels = this.channels.filter(c => c !== id); if (!this.channels.length) this.disconnect(); }
    async connect() { throw new Error('not implemented'); }
    disconnect() { this.setState('closed'); }
  }

  /* ---------- Bluetooth Low Energy GATT parsing (exported for tests) ---------- */
  // IEEE-11073 16-bit SFLOAT: 4-bit signed exponent, 12-bit signed mantissa
  function sfloat(dv, off) {
    const raw = dv.getUint16(off, true);
    if (raw === 0x07FF || raw === 0x0800 || raw === 0x0801 || raw === 0x07FE || raw === 0x0802) return NaN;
    let m = raw & 0x0FFF, e = raw >> 12;
    if (m >= 0x0800) m -= 0x1000;
    if (e >= 0x8) e -= 0x10;
    return m * Math.pow(10, e);
  }
  const round = (v, d) => Math.round(v * Math.pow(10, d)) / Math.pow(10, d);
  // 0x2A37 Heart Rate Measurement
  function parseHeartRate(dv) { const f = dv.getUint8(0); return { hr: f & 1 ? dv.getUint16(1, true) : dv.getUint8(1) }; }
  // 0x2A5F PLX Continuous Measurement or 0x2A5E Spot-check: flags, SpO2 (SFLOAT), pulse rate (SFLOAT)
  function parsePLX(dv) { const s = sfloat(dv, 1), p = sfloat(dv, 3), o = {}; if (Number.isFinite(s)) o.spo2 = round(s, 1); if (Number.isFinite(p)) o.hr = Math.round(p); return o; }
  // IEEE-11073 32-bit FLOAT: 8-bit signed exponent, 24-bit signed mantissa
  function float32(dv, off) {
    const raw = dv.getUint32(off, true);
    let m = raw & 0x00FFFFFF, e = raw >>> 24;
    if (m === 0x007FFFFF || m === 0x00800000 || m === 0x007FFFFE || m === 0x00800001 || m === 0x00800002) return NaN;
    if (m >= 0x00800000) m -= 0x01000000;
    if (e >= 0x80) e -= 0x100;
    return m * Math.pow(10, e);
  }
  // 0x2A1C Temperature Measurement: flags (bit 0 = °F), value (FLOAT)
  function parseTemp(dv) { const f = dv.getUint8(0), x = float32(dv, 1); if (!Number.isFinite(x)) return {}; return { temp: round(f & 1 ? (x - 32) / 1.8 : x, 2) }; }
  // 0x2A35 Blood Pressure Measurement: flags, systolic, diastolic, MAP (SFLOAT), [timestamp 7 B], [pulse SFLOAT]
  function parseBP(dv) {
    const f = dv.getUint8(0), k = f & 1 ? 7.50062 : 1;
    let s = sfloat(dv, 1) * k, d = sfloat(dv, 3) * k, off = 7;
    const o = {};
    if (Number.isFinite(s) && Number.isFinite(d)) o.bp = { sys: Math.round(s), dia: Math.round(d) };
    if (f & 2) off += 7;
    if (f & 4 && dv.byteLength >= off + 2) { const p = sfloat(dv, off); if (Number.isFinite(p)) o.hr = Math.round(p); }
    return o;
  }
  const BLE_PROFILES = {
    hr:   { service: 0x180D, chars: [0x2A37], parse: parseHeartRate, channels: ['hr'] },
    spo2: { service: 0x1822, chars: [0x2A5F, 0x2A5E], parse: parsePLX, channels: ['spo2'] },
    bp:   { service: 0x1810, chars: [0x2A35], parse: parseBP, channels: ['bp'] },
    temp: { service: 0x1809, chars: [0x2A1C], parse: parseTemp, channels: ['temp'] }
  };

  class BLEAdapter extends BaseAdapter {
    constructor(profile) {
      const P = BLE_PROFILES[profile];
      if (!P) throw new Error('No Bluetooth profile for ' + profile);
      super('ble', P.channels.slice(), P); this.profile = profile; this.device = null; this.char = null;
      this._on = e => { const o = P.parse(e.target.value); this.push(o); };
      this.tries = 0; this.closing = false;
      /* the link drops often (distance, body shadowing): reconnect to the same device without a new chooser */
      this._gone = () => { if (this.closing) return; this.setState('lost'); this._retry(); };
    }
    get supported() { return !!(navigator.bluetooth && navigator.bluetooth.requestDevice); }
    /* must run from a click: browsers only open the device chooser after a user gesture */
    async connect() {
      if (!this.supported) { this.setState('unsupported', new Error('Web Bluetooth is not available in this browser')); return false; }
      try {
        this.setState('requesting');
        this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [this.opts.service] }] });
        this.device.addEventListener('gattserverdisconnected', this._gone);
        await this._open();
        this.attach(); this.setState('open');
        return true;
      } catch (e) { this.setState('error', e); return false; }
    }
    async _open() {
        this.closing = false;
        const server = await this.device.gatt.connect();
        const svc = await server.getPrimaryService(this.opts.service);
        this.char = null;
        let lastErr;
        for (const c of this.opts.chars) {
          try { this.char = await svc.getCharacteristic(c); break; } catch (e) { lastErr = e; }
        }
        if (!this.char) throw lastErr || new Error('Characteristic not found');
        this.char.addEventListener('characteristicvaluechanged', this._on);
        await this.char.startNotifications();
        this.tries = 0;
    }
    async _retry() {
      if (this.closing || !this.device || this.tries >= 8) { if (this.tries >= 8) this.setState('error', new Error('Bluetooth device out of reach')); return; }
      const wait = Math.min(30000, 1000 * Math.pow(2, this.tries++));
      setTimeout(async () => { if (this.closing) return; try { await this._open(); this.setState('open'); } catch (e) { this._retry(); } }, wait);
    }
    disconnect() {
      this.closing = true;
      try { if (this.char) { this.char.removeEventListener('characteristicvaluechanged', this._on); this.char.stopNotifications().catch(() => {}); } } catch (e) {}
      try { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (e) {}
      this.char = null; this.setState('closed');
    }
  }

  /* ---------- text line parsing for serial and sockets ---------- */
  // accepts a JSON object per line, or "spo2=97, hr=64" / "co2:2.4" pairs
  function parseLine(line) {
    line = String(line).trim();
    if (!line) return null;
    if (line[0] === '{') { try { return JSON.parse(line); } catch (e) { return null; } }
    const o = {};
    line.split(/[,;\s]+/).forEach(p => { const m = p.match(/^([a-z_0-9]+)\s*[:=]\s*(.+)$/i); if (m) o[m[1].toLowerCase()] = m[2]; });
    return Object.keys(o).length ? o : null;
  }

  class SerialAdapter extends BaseAdapter {
    constructor(channels, opts) { super('serial', channels || ['radiation', 'air_co2'], Object.assign({ baudRate: 115200 }, opts)); this.port = null; this.reader = null; }
    get supported() { return !!(navigator.serial && navigator.serial.requestPort); }
    async connect() {
      if (!this.supported) { this.setState('unsupported', new Error('Web Serial is not available in this browser')); return false; }
      try {
        this.setState('requesting');
        this.port = await navigator.serial.requestPort();
        await this.port.open({ baudRate: this.opts.baudRate });
        this.attach(); this.setState('open');
        this._read();
        return true;
      } catch (e) { this.setState('error', e); return false; }
    }
    async _read() {
      const dec = new TextDecoder(); let buf = '';
      try {
        this.reader = this.port.readable.getReader();
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) { const o = parseLine(buf.slice(0, i)); buf = buf.slice(i + 1); if (o) this.push(o); }
        }
      } catch (e) { if (this.state === 'open') this.setState('lost', e); }
    }
    async disconnect() {
      try { if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); } } catch (e) {}
      try { if (this.port) await this.port.close(); } catch (e) {}
      this.reader = null; this.port = null; this.setState('closed');
    }
  }

  /* polls a JSON endpoint, e.g. a local ECLSS bridge at /api/eclss/air or a Nightscout-style CGM bridge */
  class RestPollingAdapter extends BaseAdapter {
    constructor(url, opts) { super('rest', (opts && opts.channels) || [], Object.assign({ interval: 5000, map: null }, opts)); this.url = url; this.timer = null; }
    get supported() { return typeof fetch === 'function'; }
    async poll() {
      try {
        const ac = typeof AbortController === 'function' ? new AbortController() : null, to = ac && setTimeout(() => ac.abort(), Math.max(2000, this.opts.interval));
        let r; try { r = await fetch(this.url, { cache: 'no-store', signal: ac && ac.signal }); } finally { clearTimeout(to); }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        let o = await r.json();
        if (this.opts.map) o = this.opts.map(o);
        const ids = this.push(o);
        if (!this.channels.length && ids.length) { this.channels = ids; this.attach(); }
        if (this.state !== 'open') this.setState('open');
      } catch (e) { this.setState('error', e); }
    }
    async connect() { clearInterval(this.timer); if (this.channels.length) this.attach(); this.setState('connecting'); await this.poll(); this.timer = setInterval(() => this.poll(), this.opts.interval); return this.state === 'open'; }
    disconnect() { clearInterval(this.timer); this.timer = null; this.setState('closed'); }
  }

  /* biometric shirt or any bridge sending JSON frames: {"hr":64,"spo2":97} */
  class WebSocketAdapter extends BaseAdapter {
    constructor(url, opts) { super('ws', (opts && opts.channels) || [], Object.assign({ map: null, retry: 3000 }, opts)); this.url = url; this.ws = null; this.closing = false; this.tries = 0; }
    get supported() { return typeof WebSocket === 'function'; }
    connect() {
      return new Promise(res => {
        this.closing = false; this.setState('connecting');
        try { this.ws = new WebSocket(this.url); } catch (e) { this.setState('error', e); return res(false); }
        this.ws.onopen = () => { this.tries = 0; if (this.channels.length) this.attach(); this.setState('open'); res(true); };
        this.ws.onmessage = ev => {
          if (typeof ev.data !== 'string') return;
          /* one frame may carry several lines or a JSON array of readings */
          let list = [];
          const t = ev.data.trim();
          if (t[0] === '[') { try { list = JSON.parse(t); } catch (e) { list = []; } } else list = t.split(/\r?\n/).map(parseLine);
          let ids = [];
          list.forEach(o => { if (o && this.opts.map) o = this.opts.map(o); if (o) ids = ids.concat(this.push(o)); });
          if (ids.length && ids.some(id => !this.channels.includes(id))) { this.channels = [...new Set(this.channels.concat(ids))]; this.attach(); }
        };
        this.ws.onerror = () => { this.setState('error', new Error('Socket error')); res(false); };
        this.ws.onclose = () => { if (!this.closing) { this.setState('lost'); res(false); const w = Math.min(30000, this.opts.retry * Math.pow(1.6, this.tries++)); setTimeout(() => { if (!this.closing) this.connect(); }, w); } };
      });
    }
    disconnect() { this.closing = true; try { this.ws && this.ws.close(); } catch (e) {} this.ws = null; this.setState('closed'); }
  }

  g.SensorChannel = SensorChannel;
  g.SensorAdapters = {
    SensorChannel, BaseAdapter, BLEAdapter, SerialAdapter, RestPollingAdapter, WebSocketAdapter,
    BLE_PROFILES, ingest,
    parse: { sfloat, float32, parseHeartRate, parsePLX, parseBP, parseTemp, parseLine }
  };
})(window);
