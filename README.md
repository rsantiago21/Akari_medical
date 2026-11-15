# Akari · crew health monitor (Space Apps 2026, challenge 4)

Open `index.html` by double click. Works offline from `file://`, no build, no CDN. Simulated data, fictional crew, not a medical device: Akari does not diagnose. It is a decision aid for the crew; the flight surgeon decides.

## Public app (read only)
- `index.html`: internal demo, profile p1 walking through its day on a soft loop (60×).
- `index.html?profile=p1` … `p5`: loads that static profile and runs its case. No simulator needed; works on a phone from a link.
- `index.html?mode=live`: real sensors; no demo. Tap a sensor chip to pair it (Bluetooth: pulse, oxygen, pressure, temperature; USB serial: the rest). Tap again to unplug.
- `?mode=live&ws=ws://localhost:port` or `&api=http://localhost/path` connects a bridge for every channel at load (`&every=` ms for polling, minimum 1000). Only `localhost`, `127.0.0.1` or `[::1]` are accepted.
- `?env=leo|lunar|transit|mars` sets the environment (radiation background, signal delay). Default: `leo` live, `mars` demo.
- `?tbase=37.3` fixes the crew member's resting temperature; without it Akari learns it (12 h average of afebrile readings). Whatever the baseline, fever is flagged at 38.0 °C at the latest and "act now" at 38.5 °C at the latest.

## Sensor robustness
- Units are converted on entry: °F to °C, glucose mmol/L to mg/dL, CO₂ ppm to mmHg, SpO₂ fraction to %.
- Impossible values are dropped as sensor faults (pulse 20–250, SpO₂ 50–100, temperature 25–45 °C, glucose 20–600).
- A LIVE sensor that stops sending shows "Signal lost" and leaves the index: pulse and oxygen after 30 s, CGM 20 min, temperature and CO₂ 10 min, radiation 30 min, cuff 12 h, sleep and mood 36 h.
- Bluetooth reconnects on its own (8 tries with backoff); WebSocket retries with backoff; REST polls time out.
The page has no editing control. Tapping a card opens a read-only explanation. Data only enters through `window.Akari.ingest`, the adapters, the internal demo, or the BroadcastChannel written by the simulator.

| id | profile | expected rule |
|---|---|---|
| p1 | Hana Sato, 34, healthy | none |
| p2 | Tomás Rivas, 41, type 1 diabetes, 5.2 h sleep | METABOLIC_STRESS |
| p3 | Amara Okafor, 52, hypertension 138/90, CO₂ 2.9 | SANS_RISK |
| p4 | Lukas Weber, 29, infection, 38.4 °C, fast pulse | SEPSIS_EARLY |
| p5 | Mei Lin, 38, 140 mSv, mood 2, 37.8 °C, replays a recorded NASA DONKI geomagnetic storm (raised dose rate) | RAD_IMMUNE |

**NASA data.** `data/donki-event.json` (and the same content in `js/donki-event.js`, so it loads from `file://`) is a recorded NASA DONKI event: geomagnetic storm 2026-10-10T15:00:00-GST-001, Kp 7, saved from the DONKI API on 2026-11-15. Record: https://ccmc.gsfc.nasa.gov/DONKI/view/GST/49066/-1. Profile p5 shows and cites it and raises the dose rate. There is no live call.

## Simulator (internal, not public)
`simulador.html` + `js/simulator.js`: profile picker and editor, 7 scenarios, hypoxia on top of any profile, pause and speed, per-sensor on/off and sliders, camera manual entry, “Open app with this profile”.
- It writes to `index.html` tabs over `BroadcastChannel('akari')`. **Limitation:** only tabs of the same browser on the same device. There is no relay between devices, by design.
- While the simulator is open the app's internal demo pauses; 4 s after it closes the demo resumes with the URL profile.
- The simulator runs without any access key: it is a personal tool, excluded from the public build. Keep it local or behind the A.L.E.S.S.I.A. session.
- The app never links to it.

## Public deployment policy
The public build (GitHub Pages or other) must NOT include `simulador.html`, `js/simulator.js` or `js/OpticalScanner.js`.
Run `../build-publico.sh`: it writes `../akari-publico/` with the app, the profiles and the internal demo, and fails if any simulator reference slipped in.

## Feeding data
```js
Akari.ingest({ glucose: 112, spo2: 97, bp: '118/77', hr: 64, temp: 37.1,
               air_co2: 2.4, mood: 4, sleep: 7.5, radiation: { dose: 61.4, rate: 0.02 } }, 'LIVE');
Akari.disconnect('spo2');                 // also stops the internal demo for that channel
Akari.connect('spo2');                    // demo mode: hand it back to the internal demo
Akari.connect('hr', 'ble');               // Web Bluetooth Heart Rate 0x180D (needs a click)
Akari.connect('radiation', 'serial');     // Web Serial, JSON or "key=value" per line
Akari.connect('air_co2', 'http://localhost:8080/api/eclss/air');  // REST polling
Akari.connect('hr', 'ws://localhost:8765');                       // WebSocket JSON frames
Akari.on('update', r => console.log(r.healthIndex, r.confidence, r.rules));
```

## Files
| File | Role |
|---|---|
| `js/TelemetryStore.js` | channels, weights (sum 100), normalisation |
| `js/SensorAdapters.js` | BLE (HR, PLX, BP, Health Thermometer), Serial, REST, WebSocket adapters |
| `js/ClinicalEngine.js` | thresholds, MAP, Shock Index, glucose trend, Health Index, Confidence, five rules |
| `js/profiles.js` | five fictional adult profiles |
| `js/model.js` | physiological model shared by the demo and the simulator |
| `js/UIController.js` | rendering, info popover, guided panels, figure, pulse trace, `window.Akari` |
| `js/simulator.js`, `js/OpticalScanner.js` | simulator only, never in the public build |

## Thresholds and sources
| Channel | Watch | Act now | Source |
|---|---|---|---|
| Temperature | ≥ max(37.9, baseline + 0.8) °C | ≥ max(38.5, baseline + 1.3); ≥ 40 overheating; < 35 | Stahn et al., Sci Rep 2017 (core temperature about 1 °C higher at rest in long missions) |
| Cabin CO₂ | ≥ 2.5 mmHg | 1 h average > 3.0 or reading ≥ 5 | NASA-STD-3001 Vol. 2 [V2 6004]; OCHMO-TB-004 |
| Radiation | ≥ 100 mSv or rate ≥ 2× environment background | ≥ 480 mSv (80 % of career) or rate > 0.5 mSv/h | NASA-STD-3001 Vol. 1 (career < 600 mSv); OCHMO-TB-020 |
| Glucose | < 70 or ≥ 140 mg/dL | < 54 or ≥ 250 | ADA Standards of Care (hypoglycaemia levels 1 and 2) |
| Blood pressure | ≥ 130/85 or < 100/60 | ≥ 160/100, < 90 systolic; ≥ 180/120 crisis | ACC/AHA 2017 |
| Pulse (rest) | < 50 or > 100 bpm | < 40 or > 130 | AHA adult resting range |
| SpO₂ | < 95 % | ≤ 90 % | clinical practice |
| Sleep | < 7 h, awake ≥ 16 h | < 5.5 h, awake > 18 h | AASM adult 7–9 h |

Radiation background by environment (mSv/h): LEO 0.025, Moon surface 0.057 (Chang'e-4 LND), deep-space transit 0.075 and Mars surface 0.027 (MSL-RAD).

Weights: blood pressure 12, heart rate 8, glucose 12, SpO₂ 25, mood 4, sleep 15, temperature 10, CO₂ 8, radiation 6. Each active rule removes 4 points (watch) or 8 (critical).

## AI use
The Akari logo (img/logo.png) was generated with AI. The interface code was written with AI assistance. Concept, thresholds and decisions are by team Akari-1. To change the logo, replace img/logo.png (same name, transparent or black background).
