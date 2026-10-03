# Adding a city or model

The site reads `cities/cities.json`. To add a city:

1. Put the model in `assets/`. Supported: `.stl` (binary or ASCII) and `.glb`/`.gltf`.
2. Add an entry to `cities.json`. A second city shows up in the picker automatically.

```json
{
  "id": "short-url-id",
  "name": "Display name",
  "region": "Where on Mars",
  "lat": 18.4,
  "lon": 77.5,
  "intro": "One or two sentences shown on the welcome card.",
  "model": { "file": "assets/my-city.glb", "format": "glb", "upAxis": "y", "scale": 1, "groundLevel": 0 },
  "terrain": { "flatRadius": 1500, "blendRadius": 2500 },
  "camera": { "orbit": [0, 1000, 2200], "target": [0, 40, 0], "walkStart": [0, 600] },
  "population": 1000
}
```

- `lat` is the latitude in degrees north and `lon` the longitude in degrees east. Together they set the sun path and the live local solar time.
- `region_cn` and `intro_cn` are the Chinese region name and welcome text, shown with `?lang=cn`. Without them the English text is used.
- `model.scale` converts model units to metres (use `0.0254` for inches, `0.001` for mm).
- `model.upAxis` is `z` for SketchUp STL exports, usually `y` for glTF.
- `model.groundLevel` is the height, in the model's own units, of the surface people walk on. It is placed at terrain level.
- The model is centred horizontally on its bounding box. `flatRadius` is the area of terrain flattened around the centre, then blended out to `blendRadius`.
- Cities can be linked directly: `#city=short-url-id`.

Optional extra buildings can be added to a city as `"extras": [{ "file": "assets/x.stl", "format": "stl", "upAxis": "z", "scale": 1, "position": [x, z] }]` (position in metres from the city centre).
