// Pure maths for the sun and the settlement budget. No DOM, so it can be tested in node.

export const MARS = {
  solHours: 24.6597,        // length of a sol in Mars hours-equivalent used for the slider
  obliquity: 25.19 * Math.PI / 180,
  isidisLat: 12.9 * Math.PI / 180,
};

// Sun elevation/azimuth (radians; azimuth clockwise from north) for local mean solar hour and Ls (degrees).
export function sunPosition(hour, lsDeg, latDeg = 12.9) {
  const dec = Math.asin(Math.sin(MARS.obliquity) * Math.sin(lsDeg * Math.PI / 180));
  const h = (hour / MARS.solHours - 0.5) * 2 * Math.PI;
  const phi = latDeg * Math.PI / 180;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
  const el = Math.asin(sinEl);
  const cosEl = Math.cos(el) || 1e-9;
  const sinAz = -Math.cos(dec) * Math.sin(h) / cosEl;
  const cosAz = (Math.sin(dec) - sinEl * Math.sin(phi)) / (cosEl * Math.cos(phi));
  return { el, az: Math.atan2(sinAz, cosAz), dec };
}

// Every number a user can change. All are assumptions, not measurements.
export const DEFAULTS = {
  o2KgPerPersonDay:   { v: 0.84, label: 'Oxygen use (kg/person/day)' },
  waterLPerPersonDay: { v: 25,   label: 'Water use (L/person/day)' },
  waterRecycle:       { v: 0.95, label: 'Water recycled (0–1)' },
  farmM2PerPerson:    { v: 30,   label: 'Farm area (m²/person)' },
  habM3PerPerson:     { v: 100,  label: 'Pressurised volume (m³/person)' },
  powerKWhPerPersonDay:{ v: 30,  label: 'Power (kWh/person/day)' },
  insolationKWhM2Day: { v: 2.5,  label: 'Mean sunlight at surface (kWh/m²/day)' },
  panelEff:           { v: 0.22, label: 'Solar panel efficiency (0–1)' },
  dustDerate:         { v: 0.75, label: 'Dust on panels (0–1 of clean output)' },
  stormSols:          { v: 30,   label: 'Global dust storm length (sols)' },
  stormSunFraction:   { v: 0.3,  label: 'Sunlight left in a storm (0–1)' },
};

export function budget(pop, a = {}) {
  const p = {};
  for (const k of Object.keys(DEFAULTS)) p[k] = a[k] ?? DEFAULTS[k].v;
  const powerKWhDay = pop * p.powerKWhPerPersonDay;
  const panelM2 = powerKWhDay / (p.insolationKWhM2Day * p.panelEff * p.dustDerate);
  // Storage to ride out a storm on solar alone, and the steady reactor that would avoid it instead.
  const stormDeficitKWh = powerKWhDay * p.stormSols * (1 - p.stormSunFraction);
  const reactorKWe = powerKWhDay / 24.66;
  return {
    powerMWhDay: powerKWhDay / 1000,
    reactorKWe,
    panelM2,
    panelKm2: panelM2 / 1e6,
    stormStorageMWh: stormDeficitKWh / 1000,
    o2KgDay: pop * p.o2KgPerPersonDay,
    waterMakeupLDay: pop * p.waterLPerPersonDay * (1 - p.waterRecycle),
    farmM2: pop * p.farmM2PerPerson,
    habM3: pop * p.habM3PerPerson,
  };
}

export function fmt(x, unit = '') {
  const a = Math.abs(x);
  let s;
  if (a >= 1e6) s = (x / 1e6).toFixed(1) + 'M';
  else if (a >= 1e4) s = (x / 1e3).toFixed(0) + 'k';
  else if (a >= 100) s = x.toFixed(0);
  else if (a >= 1) s = x.toFixed(1);
  else s = x.toFixed(2);
  return (s + ' ' + unit).trim();
}
