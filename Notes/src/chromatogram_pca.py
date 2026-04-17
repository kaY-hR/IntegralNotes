from __future__ import annotations

import csv
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# Blocks under src/ still need to import the workspace-local Integral SDK.
WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
INTEGRAL_SDK_ROOT = WORKSPACE_ROOT / "scripts"

if str(INTEGRAL_SDK_ROOT) not in sys.path:
    sys.path.insert(0, str(INTEGRAL_SDK_ROOT))

from integral import integral_block


class Chromatogram:
    __slots__ = ("sample_name", "rt", "intensity")

    def __init__(self, *, sample_name: str, rt: np.ndarray, intensity: np.ndarray) -> None:
        self.sample_name = sample_name
        self.rt = rt
        self.intensity = intensity


class PcaResult:
    __slots__ = (
        "sample_names",
        "input_json_name",
        "rt_axis",
        "resampled_signals",
        "scores",
        "loadings",
        "explained_variance_ratio",
        "overlap_start",
        "overlap_end",
        "n_components",
        "requested_components",
        "grid_size",
        "scale_features",
    )

    def __init__(
        self,
        *,
        sample_names: list[str],
        input_json_name: str,
        rt_axis: np.ndarray,
        resampled_signals: np.ndarray,
        scores: np.ndarray,
        loadings: np.ndarray,
        explained_variance_ratio: np.ndarray,
        overlap_start: float,
        overlap_end: float,
        n_components: int,
        requested_components: int,
        grid_size: int,
        scale_features: bool,
    ) -> None:
        self.sample_names = sample_names
        self.input_json_name = input_json_name
        self.rt_axis = rt_axis
        self.resampled_signals = resampled_signals
        self.scores = scores
        self.loadings = loadings
        self.explained_variance_ratio = explained_variance_ratio
        self.overlap_start = overlap_start
        self.overlap_end = overlap_end
        self.n_components = n_components
        self.requested_components = requested_components
        self.grid_size = grid_size
        self.scale_features = scale_features


@integral_block(
    display_name="Chromatogram PCA",
    description="Read one JSON dataset containing multiple chromatograms, run PCA, and emit score/loading plots as HTML.",
    inputs=["source"],
    outputs=["report"],
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    source_root = require_existing_directory(inputs, "source")
    report_root = require_output_directory(outputs, "report")
    options = params or {}

    input_json_path = require_single_json_file(source_root)
    chromatograms = load_chromatograms(input_json_path)

    requested_components = coerce_positive_int(options.get("n_components"), default=2)
    grid_size = coerce_positive_int(options.get("grid_size"), default=300)
    scale_features = coerce_bool(options.get("scale_features"), default=False)
    title = str(options.get("title") or "Chromatogram PCA")

    report_root.mkdir(parents=True, exist_ok=True)

    result = compute_pca(
        chromatograms=chromatograms,
        input_json_name=input_json_path.name,
        requested_components=requested_components,
        grid_size=grid_size,
        scale_features=scale_features,
    )

    figure = build_figure(title=title, result=result)
    figure.write_html(report_root / "index.html", include_plotlyjs=True, full_html=True)

    write_scores_csv(report_root / "scores.csv", result)
    write_loadings_csv(report_root / "loadings.csv", result)
    write_resampled_signals_csv(report_root / "resampled_signals.csv", result)

    summary = build_summary(title=title, result=result, params=options, source_root=source_root)
    (report_root / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (report_root / "README.txt").write_text(
        build_readme(title=title, result=result, summary=summary),
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


def require_output_directory(values: dict[str, str | None], slot_name: str) -> Path:
    candidate = (values or {}).get(slot_name)

    if not candidate:
        raise ValueError(f"Output slot '{slot_name}' is required.")

    return Path(candidate)


def require_single_json_file(source_root: Path) -> Path:
    json_files = sorted(candidate for candidate in source_root.rglob("*.json") if candidate.is_file())

    if not json_files:
        raise FileNotFoundError(f"No JSON file was found under input dataset: {source_root}")

    if len(json_files) != 1:
        listed = ", ".join(candidate.relative_to(source_root).as_posix() for candidate in json_files)
        raise ValueError(
            f"Expected exactly one JSON file under input dataset, found {len(json_files)}: {listed}"
        )

    return json_files[0]


def load_chromatograms(input_json_path: Path) -> list[Chromatogram]:
    try:
        payload = json.loads(input_json_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Failed to parse JSON file: {input_json_path}") from exc

    if not isinstance(payload, dict) or not payload:
        raise ValueError("Input JSON must be a non-empty object keyed by sample name.")

    chromatograms: list[Chromatogram] = []

    for raw_sample_name, sample_payload in payload.items():
        sample_name = str(raw_sample_name).strip()

        if not sample_name:
            raise ValueError("Input JSON must not contain empty sample names.")

        if not isinstance(sample_payload, dict):
            raise ValueError(f"Sample '{sample_name}' must be an object.")

        rt = coerce_numeric_array(sample_payload.get("rt"), sample_name=sample_name, field_name="rt")
        intensity_payload = sample_payload.get("intensity")

        if intensity_payload is None:
            intensity_payload = sample_payload.get("intesity")

        intensity = coerce_numeric_array(
            intensity_payload,
            sample_name=sample_name,
            field_name="intensity/intesity",
        )

        if rt.size != intensity.size:
            raise ValueError(
                f"Sample '{sample_name}' has mismatched array lengths: rt={rt.size}, intensity={intensity.size}"
            )

        if rt.size < 2:
            raise ValueError(f"Sample '{sample_name}' must contain at least two points.")

        chromatograms.append(normalize_chromatogram(sample_name=sample_name, rt=rt, intensity=intensity))

    if len(chromatograms) < 2:
        raise ValueError("PCA requires at least two chromatograms in the input JSON.")

    return chromatograms


def coerce_numeric_array(value: Any, *, sample_name: str, field_name: str) -> np.ndarray:
    if not isinstance(value, list):
        raise ValueError(f"Sample '{sample_name}' field '{field_name}' must be an array.")

    try:
        array = np.asarray([float(item) for item in value], dtype=float)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"Sample '{sample_name}' field '{field_name}' must contain only numbers.") from exc

    if array.ndim != 1:
        raise ValueError(f"Sample '{sample_name}' field '{field_name}' must be a one-dimensional array.")

    if not np.isfinite(array).all():
        raise ValueError(f"Sample '{sample_name}' field '{field_name}' must not contain NaN or infinity.")

    return array


def normalize_chromatogram(*, sample_name: str, rt: np.ndarray, intensity: np.ndarray) -> Chromatogram:
    order = np.argsort(rt, kind="stable")
    sorted_rt = rt[order]
    sorted_intensity = intensity[order]

    unique_rt, inverse = np.unique(sorted_rt, return_inverse=True)

    if unique_rt.size != sorted_rt.size:
        averaged_intensity = np.zeros(unique_rt.size, dtype=float)
        counts = np.zeros(unique_rt.size, dtype=int)
        np.add.at(averaged_intensity, inverse, sorted_intensity)
        np.add.at(counts, inverse, 1)
        sorted_rt = unique_rt
        sorted_intensity = averaged_intensity / counts

    if sorted_rt.size < 2:
        raise ValueError(f"Sample '{sample_name}' must contain at least two distinct rt values.")

    return Chromatogram(sample_name=sample_name, rt=sorted_rt, intensity=sorted_intensity)


def compute_pca(
    *,
    chromatograms: list[Chromatogram],
    input_json_name: str,
    requested_components: int,
    grid_size: int,
    scale_features: bool,
) -> PcaResult:
    overlap_start = max(chromatogram.rt[0] for chromatogram in chromatograms)
    overlap_end = min(chromatogram.rt[-1] for chromatogram in chromatograms)

    if overlap_start >= overlap_end:
        raise ValueError("Chromatograms do not share an overlapping rt range, so PCA cannot be computed.")

    rt_axis = np.linspace(overlap_start, overlap_end, grid_size, dtype=float)
    resampled_signals = np.vstack(
        [np.interp(rt_axis, chromatogram.rt, chromatogram.intensity) for chromatogram in chromatograms]
    )

    centered = resampled_signals - resampled_signals.mean(axis=0, keepdims=True)

    if scale_features:
        scaling = centered.std(axis=0, ddof=1)
        scaling[~np.isfinite(scaling)] = 1.0
        scaling[scaling == 0.0] = 1.0
        centered = centered / scaling

    _, singular_values, right_vectors = np.linalg.svd(centered, full_matrices=False)

    max_components = min(
        singular_values.size,
        centered.shape[0],
        centered.shape[1],
    )

    if max_components < 2:
        raise ValueError("PCA requires at least two effective components.")

    n_components = min(requested_components, max_components)
    scores = centered @ right_vectors[:n_components].T
    loadings = right_vectors[:n_components].T

    if centered.shape[0] > 1:
        explained_variance = (singular_values ** 2) / (centered.shape[0] - 1)
    else:
        explained_variance = np.zeros_like(singular_values)

    total_variance = float(explained_variance.sum())
    explained_variance_ratio = (
        explained_variance[:n_components] / total_variance
        if total_variance > 0.0
        else np.zeros(n_components, dtype=float)
    )

    return PcaResult(
        sample_names=[chromatogram.sample_name for chromatogram in chromatograms],
        input_json_name=input_json_name,
        rt_axis=rt_axis,
        resampled_signals=resampled_signals,
        scores=scores,
        loadings=loadings,
        explained_variance_ratio=explained_variance_ratio,
        overlap_start=float(overlap_start),
        overlap_end=float(overlap_end),
        n_components=n_components,
        requested_components=requested_components,
        grid_size=grid_size,
        scale_features=scale_features,
    )


def build_figure(*, title: str, result: PcaResult) -> go.Figure:
    pc1_label = component_axis_label(result, 0)
    pc2_label = component_axis_label(result, 1)

    figure = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=("Score Plot", "Loading Plot"),
        horizontal_spacing=0.12,
    )

    figure.add_trace(
        go.Scatter(
            x=result.scores[:, 0],
            y=result.scores[:, 1],
            mode="markers+text",
            text=result.sample_names,
            textposition="top center",
            marker={
                "size": 12,
                "color": list(range(len(result.sample_names))),
                "colorscale": "Tealgrn",
                "line": {"width": 1, "color": "#0f172a"},
            },
            hovertemplate=(
                "<b>%{text}</b><br>"
                + f"{pc1_label}: %{{x:.5g}}<br>"
                + f"{pc2_label}: %{{y:.5g}}"
                + "<extra></extra>"
            ),
            name="Scores",
        ),
        row=1,
        col=1,
    )

    loading_count = min(result.n_components, 3)

    for component_index in range(loading_count):
        figure.add_trace(
            go.Scatter(
                x=result.rt_axis,
                y=result.loadings[:, component_index],
                mode="lines",
                name=component_axis_label(result, component_index),
                hovertemplate=(
                    f"rt: %{{x:.5g}}<br>{component_axis_label(result, component_index)}: %{{y:.5g}}"
                    "<extra></extra>"
                ),
            ),
            row=1,
            col=2,
        )

    figure.update_xaxes(title_text=pc1_label, row=1, col=1, zeroline=True)
    figure.update_yaxes(title_text=pc2_label, row=1, col=1, zeroline=True)
    figure.update_xaxes(title_text="rt", row=1, col=2)
    figure.update_yaxes(title_text="Loading Weight", row=1, col=2, zeroline=True)

    figure.update_layout(
        title={
            "text": (
                f"{title}<br>"
                f"<sup>{result.input_json_name} | samples={len(result.sample_names)} | "
                f"grid={result.grid_size} | scale_features={str(result.scale_features).lower()}</sup>"
            )
        },
        template="plotly_white",
        width=1400,
        height=700,
        legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "xanchor": "left", "x": 0.0},
    )

    return figure


def component_axis_label(result: PcaResult, component_index: int) -> str:
    variance_ratio = result.explained_variance_ratio[component_index] * 100.0
    return f"PC{component_index + 1} ({variance_ratio:.1f}%)"


def build_summary(
    *,
    title: str,
    result: PcaResult,
    params: dict[str, Any],
    source_root: Path,
) -> dict[str, Any]:
    return {
        "title": title,
        "input_root": str(source_root),
        "input_json_name": result.input_json_name,
        "sample_names": result.sample_names,
        "sample_count": len(result.sample_names),
        "requested_components": result.requested_components,
        "computed_components": result.n_components,
        "grid_size": result.grid_size,
        "scale_features": result.scale_features,
        "rt_overlap": {
            "start": result.overlap_start,
            "end": result.overlap_end,
        },
        "explained_variance_ratio": [float(value) for value in result.explained_variance_ratio],
        "generated_files": [
            "index.html",
            "summary.json",
            "scores.csv",
            "loadings.csv",
            "resampled_signals.csv",
            "README.txt",
        ],
        "params": params,
    }


def write_scores_csv(target_path: Path, result: PcaResult) -> None:
    with target_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["sample", *[f"pc{index + 1}" for index in range(result.n_components)]])

        for sample_index, sample_name in enumerate(result.sample_names):
            writer.writerow([sample_name, *[float(value) for value in result.scores[sample_index]]])


def write_loadings_csv(target_path: Path, result: PcaResult) -> None:
    with target_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["rt", *[f"pc{index + 1}" for index in range(result.n_components)]])

        for row_index, rt_value in enumerate(result.rt_axis):
            writer.writerow([float(rt_value), *[float(value) for value in result.loadings[row_index]]])


def write_resampled_signals_csv(target_path: Path, result: PcaResult) -> None:
    with target_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["rt", *result.sample_names])

        for row_index, rt_value in enumerate(result.rt_axis):
            writer.writerow(
                [
                    float(rt_value),
                    *[float(value) for value in result.resampled_signals[:, row_index]],
                ]
            )


def build_readme(*, title: str, result: PcaResult, summary: dict[str, Any]) -> str:
    explained = ", ".join(
        f"PC{index + 1}={ratio * 100.0:.2f}%"
        for index, ratio in enumerate(result.explained_variance_ratio)
    )

    lines = [
        title,
        "=" * len(title),
        "",
        "run: src/chromatogram_pca.py:main",
        f"input_json: {result.input_json_name}",
        f"samples: {summary['sample_count']}",
        f"requested_components: {result.requested_components}",
        f"computed_components: {result.n_components}",
        f"grid_size: {result.grid_size}",
        f"scale_features: {result.scale_features}",
        f"rt_overlap: {result.overlap_start:.6g} - {result.overlap_end:.6g}",
        f"explained_variance_ratio: {explained}",
        "",
        "generated_files:",
        "- index.html",
        "- summary.json",
        "- scores.csv",
        "- loadings.csv",
        "- resampled_signals.csv",
    ]

    return "\n".join(lines) + "\n"


def coerce_positive_int(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default

    return parsed if parsed > 0 else default


def coerce_bool(value: Any, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value

    if isinstance(value, str):
        normalized = value.strip().lower()

        if normalized in {"1", "true", "yes", "on"}:
            return True

        if normalized in {"0", "false", "no", "off"}:
            return False

    return default
