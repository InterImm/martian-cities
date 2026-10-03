// Mars time and season from a real clock. No DOM, so it can be tested in node.
// Ported from the InterImm mars-clock page (assets/marsclock.js), which implements the Mars24 algorithm
// (Allison & McEwen 2000). One fix: TAI-UTC is looked up by date instead of hard-coded to 35 s.

const rad = d => d * Math.PI / 180;
const sin = d => Math.sin(rad(d)), cos = d => Math.cos(rad(d));
const mod = (x, n) => ((x % n) + n) % n;

// Leap seconds: [first UTC instant, TAI-UTC]. Valid for 2006 onwards, enough for the explorer.
const TAI_UTC = [[Date.UTC(2006, 0, 1), 33], [Date.UTC(2009, 0, 1), 34], [Date.UTC(2012, 6, 1), 35], [Date.UTC(2015, 6, 1), 36], [Date.UTC(2017, 0, 1), 37]];
export function taiMinusUtc(ms) { let v = 33; for (const [t, s] of TAI_UTC) if (ms >= t) v = s; return v; }

// date: JS Date or ms. lonEast: degrees east. Returns Ls (deg), MSD, mean solar time, true solar time (hours, 0-24).
export function marsState(date, lonEast = 0) {
  const ms = +date, jdUt = 2440587.5 + ms / 8.64e7;
  const jdTt = jdUt + (taiMinusUtc(ms) + 32.184) / 86400, j2000 = jdTt - 2451545.0;
  const M = mod(19.3870 + 0.52402075 * j2000, 360), alphaFms = mod(270.3863 + 0.52403840 * j2000, 360);
  const pbs = [[0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
               [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528], [0.0018, 32.8493, 49.095]]
    .reduce((s, [a, t, p]) => s + a * cos(0.985626 * j2000 / t + p), 0);
  const nuM = (10.691 + 3.0e-7 * j2000) * sin(M) + 0.623 * sin(2 * M) + 0.050 * sin(3 * M) + 0.005 * sin(4 * M) + 0.0005 * sin(5 * M) + pbs;
  const ls = mod(alphaFms + nuM, 360);
  const eotDeg = 2.861 * sin(2 * ls) - 0.071 * sin(4 * ls) + 0.002 * sin(6 * ls) - nuM;
  const msd = (j2000 - 4.5) / 1.027491252 + 44796.0 - 0.00096;
  const mtc = mod(24 * msd, 24);
  const lmst = mod(mtc + lonEast / 15, 24);          // mean solar time at this longitude
  const ltst = mod(lmst + eotDeg * 24 / 360, 24);    // true (apparent) solar time: what a sundial reads
  return { ls, msd, mtc, lmst, ltst, eotHours: eotDeg * 24 / 360 };
}
