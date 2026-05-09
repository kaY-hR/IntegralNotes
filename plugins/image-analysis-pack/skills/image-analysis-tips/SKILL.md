---
name: image-analysis-tips
description: "Use when giving tips for analyzing image files, such as PNG, JPEG, WebP, TIFF, or other raster formats, or when explaining how to use Python imaging libraries such as Pillow, OpenCV, scikit-image, or imageio in an IntegralNotes block."
---

# Image Analysis Tips

Use this skill when working with image analysis scripts, image outputs, or `.icv`
image comparison manifests in an IntegralNotes workspace.

When implementing or revising an `@integral_block` Python file, also use the
`implement-integral-block` skill. This skill only adds image-specific guidance
and helper files.

## First Read

For `.icv` image compare outputs, or for any block that creates aligned
overlays, masks, labels, detections, segmentation images, or before/after image
pairs, read:

1. [references/image-compare-manifest.md](references/image-compare-manifest.md)

Useful local assets:

- `../../shared/integral_image_compare.py`: package shared helper module for writing `.icv` manifests.
- `scripts/create_image_compare_manifest.py`: command-line helper for manually creating `.icv` files.
- `templates/image_compare_block.py`: starter `@integral_block` that emits an `.icv` file.

## Default Output Policy

When an image-analysis block creates a visual artifact that is spatially aligned
with an input image and is meant to be visually compared with that input, it
MUST also declare and write an `.icv` output slot named `compare_view`, unless
the user explicitly asks not to or the artifact is not spatially aligned.

This applies to overlays, masks, label maps, detection drawings, segmentation
maps, annotated originals, before/after images, UV/RGB pairs, and other
registered image layers. Standalone charts, crop galleries, numeric CSVs, HTML
reports, or non-registered visualizations do not require `.icv` by default.

Keep the ordinary renderable artifact too. For example, if a block writes an
`overlay` PNG, keep `overlay` as a PNG output and add a separate `compare_view`
`.icv` output. Do not replace the image/table result with `.icv`.

When drafting an `itg-notes` block, make sure the `out:` section includes the
`.icv` output path whenever the script declares `compare_view`. Do not set
`auto_insert_to_work_note` on `.icv` unless note embedding support for `.icv` is
known to be available; keep auto-insertion on the PNG/HTML artifact instead.

## Tips

### cv2.imread() on Windows does not support paths with Japanese characters

Windows上で `cv2.imread()` は日本語を含むパスを読み込めない。`np.fromfile()` でバイト列として読み込み `cv2.imdecode()` でデコードする。

The helper SDK has `cv2_imread_unicode()` and `cv2_imwrite_unicode()` wrappers
for this pattern.
