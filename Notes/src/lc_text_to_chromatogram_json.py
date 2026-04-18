from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from integral import integral_block


@integral_block(
    display_name="LC Text To Chromatogram JSON",
    description="Aggregate LabSolutions LC text exports from one bundle into a chromatogram JSON file.",
    inputs=[
        {"name": "source", "extensions": [".idts"], "format": "bundle/idts"},
    ],
    outputs=[
        {"name": "json", "extension": ".json", "format": "chromatogram/json"},
    ],
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    source_root = require_existing_directory(inputs, "source")
    output_path = require_output_file(outputs, "json")
    options = params or {}
    pattern = str(options.get("glob") or "*.txt")

    payload: dict[str, dict[str, list[float]]] = {}

    txt_paths = sorted(candidate for candidate in source_root.glob(pattern) if candidate.is_file())
    if not txt_paths:
        raise FileNotFoundError(f"No files matched pattern '{pattern}' in {source_root}")

    for txt_path in txt_paths:
        chromatogram = parse_chromatogram_file(txt_path)
        if chromatogram is None:
            continue

        relative_name = txt_path.relative_to(source_root).as_posix()
        payload[relative_name] = chromatogram

    if not payload:
        raise ValueError(f"No chromatogram sections were found in files matched by '{pattern}'")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def require_existing_directory(values: dict[str, str | None], slot_name: str) -> Path:
    candidate = (values or {}).get(slot_name)
    if not candidate:
        raise ValueError(f"Input slot '{slot_name}' is required.")

    directory = Path(candidate)
    if not directory.exists():
        raise FileNotFoundError(f"Input path does not exist: {directory}")
    if not directory.is_dir():
        raise NotADirectoryError(f"Input path is not a directory: {directory}")

    return directory


def require_output_file(values: dict[str, str | None], slot_name: str) -> Path:
    candidate = (values or {}).get(slot_name)
    if not candidate:
        raise ValueError(f"Output slot '{slot_name}' is required.")

    return Path(candidate)


def parse_chromatogram_file(path: Path) -> dict[str, list[float]] | None:
    lines = read_text_with_fallbacks(path).splitlines()
    section_index = find_first_index(lines, lambda value: value.startswith("[LC Chromatogram("))
    if section_index is None:
        return None

    multiplier = 1.0
    header_index: int | None = None

    for index in range(section_index + 1, len(lines)):
        line = lines[index].strip()
        if not line:
            continue
        if line.startswith("["):
            break
        if line.startswith("Intensity Multiplier,"):
            _, raw_value = split_csv_pair(line, path=path, line_number=index + 1)
            multiplier = parse_float(raw_value, path=path, line_number=index + 1)
            continue
        if line == "R.Time (min),Intensity":
            header_index = index
            break

    if header_index is None:
        raise ValueError(f"Chromatogram header not found in {path}")

    rt_values: list[float] = []
    intensity_values: list[float] = []

    for index in range(header_index + 1, len(lines)):
        line = lines[index].strip()
        if not line:
            continue
        if line.startswith("["):
            break

        raw_rt, raw_intensity = split_csv_pair(line, path=path, line_number=index + 1)
        rt_values.append(normalize_float(parse_float(raw_rt, path=path, line_number=index + 1)))
        intensity_values.append(
            normalize_float(parse_float(raw_intensity, path=path, line_number=index + 1) * multiplier)
        )

    if not rt_values:
        raise ValueError(f"Chromatogram data rows were not found in {path}")

    return {
        "rt": rt_values,
        "intesity": intensity_values,
    }


def read_text_with_fallbacks(path: Path) -> str:
    last_error: UnicodeDecodeError | None = None

    for encoding in ("utf-8-sig", "cp932", "utf-16", "utf-16-le", "utf-16-be"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError as error:
            last_error = error

    if last_error is not None:
        raise ValueError(f"Could not decode text file: {path}") from last_error

    raise ValueError(f"Could not decode text file: {path}")


def find_first_index(values: list[str], predicate: Any) -> int | None:
    for index, value in enumerate(values):
        if predicate(value.strip()):
            return index

    return None


def split_csv_pair(value: str, *, path: Path, line_number: int) -> tuple[str, str]:
    parts = value.split(",", 1)
    if len(parts) != 2:
        raise ValueError(f"Expected a two-column CSV line in {path} at line {line_number}: {value}")

    return parts[0].strip(), parts[1].strip()


def parse_float(value: str, *, path: Path, line_number: int) -> float:
    try:
        return float(value)
    except ValueError as error:
        raise ValueError(f"Could not parse numeric value in {path} at line {line_number}: {value}") from error


def normalize_float(value: float) -> float:
    rounded = round(value, 12)
    return 0.0 if abs(rounded) < 1e-12 else rounded
