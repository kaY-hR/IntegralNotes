from __future__ import annotations

from pathlib import Path
from typing import Any
import sys


def _find_workspace_skill_sdk(start: Path) -> Path | None:
    for parent in (start.parent, *start.parents):
        candidate = parent / ".codex" / "skills" / "image-analysis-tips" / "sdk"
        if candidate.exists():
            return candidate
    return None


SKILL_SDK_ROOT = _find_workspace_skill_sdk(Path(__file__).resolve())
if SKILL_SDK_ROOT is not None:
    sys.path.insert(0, str(SKILL_SDK_ROOT))

from integral import integral_block
from integral_image_compare import make_layer, require_image_input, require_output_file, write_manifest


@integral_block(
    display_name="Create Image Compare View",
    description="Create an .icv image comparison manifest from two aligned images.",
    inputs=[
        {"name": "primary", "extensions": [".bmp", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"], "datatype": "integral/image"},
        {"name": "secondary", "extensions": [".bmp", ".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"], "datatype": "integral/image"},
    ],
    outputs=[
        {"name": "compare_view", "extension": ".icv", "datatype": "integral/image-compare-view"},
    ],
    params={
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "title": "Viewer title",
                "default": "Image comparison",
            },
            "primary_label": {
                "type": "string",
                "title": "Primary label",
                "default": "Primary",
            },
            "secondary_label": {
                "type": "string",
                "title": "Secondary label",
                "default": "Secondary",
            },
            "secondary_opacity": {
                "type": "number",
                "title": "Secondary opacity",
                "default": 0.65,
                "minimum": 0,
                "maximum": 1,
            },
        },
    },
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    options = params or {}
    primary = require_image_input(inputs.get("primary"), "primary")
    secondary = require_image_input(inputs.get("secondary"), "secondary")
    output = require_output_file(outputs.get("compare_view"), "compare_view", expected_extension=".icv")

    write_manifest(
        output,
        [
            make_layer(
                primary,
                manifest_path=output,
                layer_id="primary",
                label=str(options.get("primary_label") or "Primary"),
            ),
            make_layer(
                secondary,
                manifest_path=output,
                layer_id="secondary",
                label=str(options.get("secondary_label") or "Secondary"),
                opacity=float(options.get("secondary_opacity") or 0.65),
            ),
        ],
        name=str(options.get("title") or "Image comparison"),
    )
