# Image Compare Manifest

IntegralNotes can open `.icv` files as image comparison views. An `.icv` file is
a UTF-8 JSON manifest that points to one or more aligned workspace images.

`.icv` is intentionally path-based for now. It does not use managed data IDs or
`.idts` member metadata yet.

## Minimal Manifest

```json
{
  "name": "Cell image comparison",
  "images": [
    { "id": "rgb", "label": "RGB", "path": "rgb.png" },
    { "id": "uv", "label": "UV", "path": "uv.png", "opacity": 0.65 }
  ]
}
```

The top-level image array may be named `images`, `layers`, or `members`.

## Layer Fields

Each layer can be either a string path or an object.

Supported object fields:

- `path`, `relativePath`, `src`, or `file`: image path.
- `id`: stable layer ID.
- `label`, `name`, or `displayName`: UI label.
- `opacity`: `0.0` to `1.0`; values from `0` to `100` are treated as percent.
- `scale`: image scale. The viewer clamps interactive edits to `0.1` to `3.0`.
- `offsetX`: horizontal offset in pixels.
- `offsetY`: vertical offset in pixels.
- `rotation`, `rotate`, or `rotationDeg`: degrees.

Optional top-level canvas fields:

- `width` and `height`
- or `canvas: { "width": ..., "height": ... }`

When canvas size is omitted, the viewer uses the first loaded image's natural
size.

## Path Rules

Use workspace paths, preferably relative to the `.icv` file location:

```json
{
  "images": [
    { "path": "rgb.png" },
    { "path": "../Data/uv.png" },
    { "path": "/Data/original.png" }
  ]
}
```

Paths beginning with `/` are treated as workspace-root relative. Other paths are
resolved relative to the `.icv` manifest's directory.

## Python Block Pattern

### When to emit `.icv`

If a Python image-analysis block produces an output image that is spatially
aligned with an input image and useful for visual comparison, the block must
also emit a `compare_view` `.icv` output unless the user explicitly opts out.

This is required for common analysis outputs such as:

- detection overlays drawn on the original image
- label maps, masks, and segmentation maps
- annotated originals
- registered before/after images
- UV/RGB or channel comparison image sets

Keep the normal artifact output as well. For example, an overlay image should
remain a PNG output, and the `.icv` manifest should be an additional output that
references the original image and the overlay image.

Declare `.icv` as a normal single-file output slot:

```python
outputs=[
    {
        "name": "overlay",
        "extension": ".png",
        "datatype": "integral/image",
        "auto_insert_to_work_note": True,
    },
    {
        "name": "compare_view",
        "extension": ".icv",
        "datatype": "integral/image-compare-view",
    },
]
```

Do not use `.idts` output helpers for `.icv`. The runtime passes a file path for
the `.icv` output, so the block should create the parent directory and write JSON
to that file.

Use package `shared/integral_image_compare.py` when useful:

```python
from integral_image_compare import make_layer, write_manifest

overlay_path = outputs["overlay"]
compare_path = outputs["compare_view"]

# Write the overlay PNG first, then create the manifest that points to it.
write_manifest(
    compare_path,
    [
        make_layer(inputs["image"], manifest_path=compare_path, layer_id="source", label="Source"),
        make_layer(overlay_path, manifest_path=compare_path, layer_id="overlay", label="Overlay", opacity=0.65),
    ],
    name="Source / overlay compare",
)
```
