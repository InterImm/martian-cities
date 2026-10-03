# Isidis Procyon explorer

A static, zero-backend site: the Isidis Procyon city model in 3D plus a settlement budget. Everything runs in the browser, so it hosts for free on GitHub Pages.

- `js/main.js`: three.js scene, orbit and walk modes, sun/season sliders
- `js/sim.js`: sun position and the population budget (plain maths, no DOM)
- `assets/isidis-city-procyon.stl`: copy of `city-plan/isidis-procyon/isidis-city-procyon.stl`
- `vendor/`: three.js r170 and the STL loader and controls, so there is no CDN dependency

Run locally: `cd web && python3 -m http.server`, then open http://localhost:8000.
Test the maths: `node web/sim.test.mjs`.

Known limits: terrain is procedural and illustrative (no real Isidis elevation yet), STL units are assumed to be metres, and the budget figures are editable assumptions, not mission data.
