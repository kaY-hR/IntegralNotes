from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

IMAGE_COMPARE_EXTENSION = ".icv"
IMAGE_EXTENSIONS = {
    ".bmp",
    ".gif",
    ".jpg",
    ".jpeg",
    ".png",
    ".svg",
    ".webp",
}


@dataclass(frozen=True)
class ImageCompareLayer:
    path: str
    id: str | None = None
    label: str | None = None
    opacity: float = 1.0
    scale: float = 1.0
    offsetX: float = 0.0
    offsetY: float = 0.0
    rotation: float = 0.0

    def to_manifest_dict(self) -> dict[str, Any]:
        item: dict[str, Any] = {"path": self.path}

        if self.id:
            item["id"] = self.id
        if self.label:
            item["label"] = self.label

        item["opacity"] = _clamp(self.opacity, 0.0, 1.0)

        if self.scale != 1.0:
            item["scale"] = self.scale
        if self.offsetX != 0.0:
            item["offsetX"] = self.offsetX
        if self.offsetY != 0.0:
            item["offsetY"] = self.offsetY
        if self.rotation != 0.0:
            item["rotation"] = self.rotation

        return item


def make_layer(
    image_path: str | os.PathLike[str],
    *,
    manifest_path: str | os.PathLike[str] | None = None,
    layer_id: str | None = None,
    label: str | None = None,
    opacity: float = 1.0,
    scale: float = 1.0,
    offset_x: float = 0.0,
    offset_y: float = 0.0,
    rotation: float = 0.0,
) -> ImageCompareLayer:
    image = Path(image_path)
    manifest = Path(manifest_path) if manifest_path is not None else None
    manifest_path_text = to_manifest_relative_path(image, manifest)
    stem = image.stem or Path(manifest_path_text).stem or "image"

    return ImageCompareLayer(
        path=manifest_path_text,
        id=layer_id or safe_layer_id(stem),
        label=label or stem,
        opacity=opacity,
        scale=scale,
        offsetX=offset_x,
        offsetY=offset_y,
        rotation=rotation,
    )


def build_manifest(
    layers: Iterable[ImageCompareLayer | dict[str, Any] | str],
    *,
    name: str | None = None,
    width: int | None = None,
    height: int | None = None,
) -> dict[str, Any]:
    manifest_layers: list[dict[str, Any] | str] = []

    for layer in layers:
        if isinstance(layer, ImageCompareLayer):
            manifest_layers.append(layer.to_manifest_dict())
        elif isinstance(layer, str):
            manifest_layers.append(layer)
        else:
            manifest_layers.append(dict(layer))

    manifest: dict[str, Any] = {"images": manifest_layers}

    if name:
        manifest["name"] = name

    if width is not None or height is not None:
        if width is None or height is None:
            raise ValueError("width and height must be provided together.")
        if width <= 0 or height <= 0:
            raise ValueError("width and height must be positive.")
        manifest["canvas"] = {"width": int(width), "height": int(height)}

    return manifest


def write_manifest(
    output_path: str | os.PathLike[str],
    layers: Iterable[ImageCompareLayer | dict[str, Any] | str],
    *,
    name: str | None = None,
    width: int | None = None,
    height: int | None = None,
) -> Path:
    output = require_output_file(output_path, "compare_view", expected_extension=IMAGE_COMPARE_EXTENSION)
    manifest = build_manifest(layers, name=name, width=width, height=height)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return output


def require_input_file(
    value: str | os.PathLike[str] | None,
    slot_name: str,
    *,
    allowed_extensions: set[str] | None = None,
) -> Path:
    if value is None or str(value).strip() == "":
        raise ValueError(f"input slot '{slot_name}' is required.")

    path = Path(value)

    if not path.is_file():
        raise FileNotFoundError(f"input slot '{slot_name}' is not a file: {path}")

    if allowed_extensions is not None and path.suffix.lower() not in allowed_extensions:
        allowed = ", ".join(sorted(allowed_extensions))
        raise ValueError(f"input slot '{slot_name}' must be one of: {allowed}")

    return path


def require_image_input(value: str | os.PathLike[str] | None, slot_name: str) -> Path:
    return require_input_file(value, slot_name, allowed_extensions=IMAGE_EXTENSIONS)


def require_output_file(
    value: str | os.PathLike[str] | None,
    slot_name: str,
    *,
    expected_extension: str | None = None,
) -> Path:
    if value is None or str(value).strip() == "":
        raise ValueError(f"output slot '{slot_name}' is required.")

    path = Path(value)

    if expected_extension and path.suffix.lower() != expected_extension.lower():
        raise ValueError(
            f"output slot '{slot_name}' must use {expected_extension}: {path}"
        )

    return path


def to_manifest_relative_path(
    image_path: str | os.PathLike[str],
    manifest_path: str | os.PathLike[str] | None,
) -> str:
    image = Path(image_path)

    if manifest_path is None or not image.is_absolute():
        return image.as_posix()

    base = Path(manifest_path).parent
    return Path(os.path.relpath(image, base)).as_posix()


def safe_layer_id(value: str) -> str:
    cleaned = "".join(character if character.isalnum() or character in "._-" else "-" for character in value)
    cleaned = cleaned.strip("-._")
    return cleaned or "image"


def cv2_imread_unicode(path: str | os.PathLike[str], flags: int | None = None) -> Any:
    import cv2
    import numpy as np

    read_flags = cv2.IMREAD_UNCHANGED if flags is None else flags
    data = np.fromfile(str(path), dtype=np.uint8)
    image = cv2.imdecode(data, read_flags)

    if image is None:
        raise ValueError(f"failed to decode image: {path}")

    return image


def cv2_imwrite_unicode(
    path: str | os.PathLike[str],
    image: Any,
    *,
    extension: str | None = None,
    params: list[int] | None = None,
) -> Path:
    import cv2

    output = Path(path)
    ext = extension or output.suffix or ".png"
    success, encoded = cv2.imencode(ext, image, params or [])

    if not success:
        raise ValueError(f"failed to encode image as {ext}: {output}")

    output.parent.mkdir(parents=True, exist_ok=True)
    encoded.tofile(str(output))
    return output


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, float(value)))
