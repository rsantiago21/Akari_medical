/* Akari · test profiles (all adults, all fictional)
   base: resting values of the nine channels. amp: size of the daily (circadian) swing.
   tempBase: the crew member's measured in-flight resting temperature (fever is judged against it).
   focus: channels the declared condition puts first on screen. exercise: mission hours with a 30 min workout.
   Classic script: exposes window.AKARI_PROFILES. */
(function (g) {
  'use strict';
  const P = {
    p1: { id: 'p1', tempBase: 37.1, name: 'Hana Sato', role: 'Commander', sex: 'F', age: 34, weight: 61, height: 165, blood: 'O+', conds: [], notes: 'No regular medication',
      sol: 142, story: 'Sol 142 · routine day, all systems nominal', focus: [], exercise: [10, 17],
      base: { hr: 63, sys: 117, dia: 77, glucose: 94, spo2: 98, mood: 4, sleep: 7.67, temp: 37.05, co2: 1.8, dose: 61.4, rate: 0.02 },
      amp: { hr: 3, sys: 3, temp: 0.12, co2: 0.12 } },
    p2: { id: 'p2', tempBase: 37.0, name: 'Tomás Rivas', role: 'Flight engineer', sex: 'M', age: 41, weight: 78, height: 178, blood: 'A+', conds: ['Type 1 diabetes'], notes: 'Insulin pump; irregular sleep after a schedule shift',
      sol: 96, story: 'Sol 96 · third short night after a schedule shift', focus: ['glucose', 'sleep'], exercise: [17],
      base: { hr: 70, sys: 122, dia: 79, glucose: 150, spo2: 97, mood: 3, sleep: 5.2, temp: 37.0, co2: 1.9, dose: 38.2, rate: 0.02 },
      amp: { hr: 3, sys: 3, temp: 0.1, co2: 0.1 } },
    p3: { id: 'p3', tempBase: 36.9, name: 'Amara Okafor', role: 'Mission specialist', sex: 'F', age: 52, weight: 70, height: 168, blood: 'B+', conds: ['Hypertension'], notes: 'Lisinopril 10 mg each morning',
      sol: 210, story: 'Sol 210 · scrubber running at half capacity', focus: ['bp', 'air_co2'], exercise: [11],
      base: { hr: 72, sys: 138, dia: 90, glucose: 101, spo2: 97, mood: 3, sleep: 7.1, temp: 36.95, co2: 2.9, dose: 88.6, rate: 0.02 },
      amp: { hr: 3, sys: 2, temp: 0.1, co2: 0.08 } },
    p4: { id: 'p4', tempBase: 37.0, name: 'Lukas Weber', role: 'Pilot', sex: 'M', age: 29, weight: 74, height: 182, blood: 'O-', conds: ['Recent infection'], notes: 'Wound on left hand after a hatch repair',
      sol: 58, story: 'Sol 58 · day 2 after a cut during a hatch repair', focus: ['temp', 'hr'], exercise: [],
      base: { hr: 108, sys: 112, dia: 71, glucose: 112, spo2: 96, mood: 3, sleep: 6.6, temp: 38.4, co2: 2.1, dose: 22.4, rate: 0.02 },
      amp: { hr: 2, sys: 2, temp: 0.08, co2: 0.1 } },
    p5: { id: 'p5', tempBase: 37.1, name: 'Mei Lin', role: 'Science officer', sex: 'F', age: 38, weight: 57, height: 160, blood: 'AB+', conds: ['Radiation exposure'], notes: 'Post-EVA, extra dose logged during a solar event', event: 'donki',
      sol: 301, story: 'Sol 301 · post-EVA fatigue after a solar particle event', focus: ['radiation', 'mood'], exercise: [],
      base: { hr: 82, sys: 121, dia: 78, glucose: 104, spo2: 97, mood: 2, sleep: 6.4, temp: 37.85, co2: 2.0, dose: 140, rate: 0.03 },
      amp: { hr: 3, sys: 3, temp: 0.05, co2: 0.1 } }
  };
  g.AKARI_PROFILES = P;
})(window);
