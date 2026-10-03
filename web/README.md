# Isidis Procyon explorer

A static, zero-backend site: the Isidis Procyon city model in 3D with the real Martian sun. Everything runs in the browser, so it hosts for free on GitHub Pages.

- `js/main.js`: three.js scene, orbit and walk modes, sun/season sliders
- `js/sim.js`: sun position (plain maths, no DOM)
- `assets/isidis-city-procyon.stl`: copy of `city-plan/isidis-procyon/isidis-city-procyon.stl`
- Header, footer, colours and fonts: the shared InterImm kit, linked from `https://interimm.org/kit/` (see [its notes](https://github.com/InterImm/interimm.github.io/blob/hugo/kit/README.md)); running locally needs internet for that
- `vendor/`: three.js r170 and the STL loader and controls, so there is no CDN dependency

Run locally: `cd web && python3 -m http.server`, then open http://localhost:8000.
Test the maths: `node web/sim.test.mjs`.

Known limits: terrain is procedural and illustrative (no real Isidis elevation yet), STL units are assumed to be metres.
