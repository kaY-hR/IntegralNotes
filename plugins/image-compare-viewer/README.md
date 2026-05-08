# Image Compare Viewer

`.icv` image comparison manifests を表示する viewer plugin。

## Manifest

```json
{
  "name": "Cell image comparison",
  "images": [
    { "id": "source", "label": "Source", "path": "source.png" },
    { "id": "overlay", "label": "Overlay", "path": "overlay.png", "opacity": 0.65 }
  ]
}
```

`images` の代わりに `layers` または `members` も使える。

Layer の `path` / `relativePath` / `src` / `file` は `.icv` manifest からの相対 path、または workspace root からの `/Data/foo.png` 形式で指定する。

## Install for development

```powershell
npm run plugins:install:all
```

