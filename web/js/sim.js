// Pure maths for the sun. No DOM, so it can be tested in node.

export const MARS = {
  solHours: 24.6597,        // length of a sol in Mars hours-equivalent used for the slider
  obliquity: 25.19 * Math.PI / 180,
  isidisLat: 12.9 * Math.PI / 180,
};

// Sun elevation/azimuth (radians; azimuth clockwise from north) for local mean solar hour and Ls (degrees).
export function sunPosition(hour, lsDeg, latDeg = 12.9) {
  const sl = Math.sin(lsDeg * Math.PI / 180), dec = Math.asin(Math.sin(MARS.obliquity) * sl) + 0.25 * Math.PI / 180 * sl; // Mars24 planetographic declination
  const h = (hour / MARS.solHours - 0.5) * 2 * Math.PI;
  const phi = latDeg * Math.PI / 180;
  const sinEl = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
  const el = Math.asin(sinEl);
  const cosEl = Math.cos(el) || 1e-9;
  const sinAz = -Math.cos(dec) * Math.sin(h) / cosEl;
  const cosAz = (Math.sin(dec) - sinEl * Math.sin(phi)) / (cosEl * Math.cos(phi));
  return { el, az: Math.atan2(sinAz, cosAz), dec };
}
