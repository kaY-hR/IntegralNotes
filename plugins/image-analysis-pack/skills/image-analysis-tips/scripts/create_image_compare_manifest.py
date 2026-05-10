from __future__ import annotations

import argparse
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_SHARED_ROOT = SKILL_ROOT.parents[1] / "shared"
sys.path.insert(0, str(PACKAGE_SHARED_ROOT))

from integral_image_compare import make_layer, write_manifest  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Create an IntegralNotes .icv image comparison manifest."
    )
    parser.add_argument("output", help="Output .icv file path.")
    parser.add_argument("images", nargs="+", help="Image paths to compare.")
    parser.add_argument("--name", default=None, help="Viewer title.")
    parser.add_argument(
        "--label",
        action="append",
        default=[],
        help="Layer label. Repeat in the same order as images.",
    )
    parser.add_argument(
        "--opacity",
        action="append",
        default=[],
        type=float,
        help="Layer opacity from 0.0 to 1.0. Repeat in image order.",
    )
    parser.add_argument("--width", type=int, default=None, help="Canvas width.")
    parser.add_argument("--height", type=int, default=None, help="Canvas height.")
    args = parser.parse_args()

    output = Path(args.output).expanduser()
    labels = list(args.label)
    opacities = list(args.opacity)

    layers = []
    for index, raw_image_path in enumerate(args.images):
        image_path = Path(raw_image_path).expanduser()
        if not image_path.is_absolute():
            image_path = Path.cwd() / image_path
        if not image_path.is_file():
            parser.error(f"image does not exist: {image_path}")

        layers.append(
            make_layer(
                image_path,
                manifest_path=output,
                label=labels[index] if index < len(labels) else None,
                opacity=opacities[index] if index < len(opacities) else 1.0,
            )
        )

    write_manifest(
        output,
        layers,
        name=args.name,
        width=args.width,
        height=args.height,
    )
    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
