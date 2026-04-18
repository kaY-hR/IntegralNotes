from __future__ import annotations

import html
import json
import sys
from pathlib import Path
from typing import Any

# Blocks under src/ still need to import the workspace-local Integral SDK.
WORKSPACE_ROOT = Path(__file__).resolve().parents[1]
INTEGRAL_SDK_ROOT = WORKSPACE_ROOT / "scripts"

if str(INTEGRAL_SDK_ROOT) not in sys.path:
    sys.path.insert(0, str(INTEGRAL_SDK_ROOT))

from integral import integral_block


@integral_block(
    display_name="LC Text To Chromatogram",
    description="Aggregate LabSolutions LC text exports from one bundle and emit both chromatogram JSON and an HTML plot.",
    inputs=[
        {"name": "source", "extensions": [".idts"], "format": "bundle/idts"},
    ],
    outputs=[
        {
            "name": "json",
            "extension": ".json",
            "format": "chromatogram/json",
            "project_to_inputs": ["source"],
        },
        {
            "name": "plot",
            "extension": ".html",
            "format": "report/html",
            "auto_insert_to_work_note": True,
            "project_to_inputs": ["source"],
        },
    ],
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    source_root = require_existing_directory(inputs, "source")
    json_output_path = require_output_file(outputs, "json")
    plot_output_path = require_output_file(outputs, "plot")
    options = params or {}
    pattern = str(options.get("glob") or "*.txt")
    title = str(options.get("title") or "LC Chromatograms Overlay")
    line_width = coerce_positive_float(options.get("line_width"), default=1.5)
    height = coerce_positive_int(options.get("height"), default=720)

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

    traces = build_traces(payload)

    json_output_path.parent.mkdir(parents=True, exist_ok=True)
    json_output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    plot_output_path.parent.mkdir(parents=True, exist_ok=True)
    plot_output_path.write_text(
        build_plot_html(
            title=title,
            json_name=json_output_path.name,
            traces=traces,
            line_width=line_width,
            height=height,
        ),
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


def build_traces(payload: dict[str, dict[str, list[float]]]) -> list[dict[str, Any]]:
    traces: list[dict[str, Any]] = []

    for series_name, chromatogram in payload.items():
        raw_rt = chromatogram.get("rt")
        raw_intensity = chromatogram.get("intesity")

        if not isinstance(raw_rt, list):
            raise ValueError(f"Expected '{series_name}.rt' to be a list.")
        if not isinstance(raw_intensity, list):
            raise ValueError(f"Expected '{series_name}.intesity' to be a list.")
        if len(raw_rt) != len(raw_intensity):
            raise ValueError(
                f"Expected '{series_name}.rt' and '{series_name}.intesity' to have the same length."
            )
        if not raw_rt:
            raise ValueError(f"Expected '{series_name}' to contain at least one point.")

        traces.append(
            {
                "name": series_name,
                "x": [float(value) for value in raw_rt],
                "y": [float(value) for value in raw_intensity],
            }
        )

    return traces


def coerce_positive_float(value: Any, *, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default

    return parsed if parsed > 0 else default


def coerce_positive_int(value: Any, *, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default

    return parsed if parsed > 0 else default


def build_plot_html(
    *,
    title: str,
    json_name: str,
    traces: list[dict[str, Any]],
    line_width: float,
    height: int,
) -> str:
    try:
        import plotly.graph_objects as go
    except ImportError:
        return build_cdn_html(
            title=title,
            json_name=json_name,
            traces=traces,
            line_width=line_width,
            height=height,
        )

    figure = go.Figure()
    for trace in traces:
        figure.add_trace(
            go.Scattergl(
                x=trace["x"],
                y=trace["y"],
                mode="lines",
                name=trace["name"],
                line={"width": line_width},
            )
        )

    figure.update_layout(
        title=title,
        template="plotly_white",
        height=height,
        hovermode="x unified",
        legend={"orientation": "h", "yanchor": "bottom", "y": 1.02, "xanchor": "left", "x": 0.0},
        margin={"l": 64, "r": 32, "t": 96, "b": 64},
        xaxis_title="R.Time (min)",
        yaxis_title="Intensity",
    )
    figure.update_xaxes(showline=True, linewidth=1, linecolor="#94a3b8", mirror=True)
    figure.update_yaxes(showline=True, linewidth=1, linecolor="#94a3b8", mirror=True)
    return figure.to_html(full_html=True, include_plotlyjs="inline")


def build_cdn_html(
    *,
    title: str,
    json_name: str,
    traces: list[dict[str, Any]],
    line_width: float,
    height: int,
) -> str:
    safe_title = html.escape(title)
    safe_json_name = html.escape(json_name)
    safe_trace_count = len(traces)
    serialized_traces = safe_json_for_script(
        json.dumps(
            [
                {
                    "type": "scattergl",
                    "mode": "lines",
                    "name": trace["name"],
                    "x": trace["x"],
                    "y": trace["y"],
                    "line": {"width": line_width},
                }
                for trace in traces
            ],
            ensure_ascii=False,
        )
    )

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{safe_title}</title>
    <script src="https://cdn.plot.ly/plotly-2.35.2.min.js"></script>
    <style>
      :root {{
        color-scheme: light;
        font-family: "Segoe UI", sans-serif;
      }}

      body {{
        margin: 0;
        background: #f8fafc;
        color: #0f172a;
      }}

      main {{
        max-width: 1280px;
        margin: 0 auto;
        padding: 24px;
      }}

      .meta {{
        margin-bottom: 16px;
        padding: 12px 16px;
        border: 1px solid #cbd5e1;
        background: #ffffff;
      }}

      #plot {{
        height: {height}px;
        border: 1px solid #cbd5e1;
        background: #ffffff;
      }}
    </style>
  </head>
  <body>
    <main>
      <h1>{safe_title}</h1>
      <div class="meta">
        <strong>Input JSON:</strong> {safe_json_name}<br>
        <strong>Traces:</strong> {safe_trace_count}<br>
        <strong>Rendering:</strong> Plotly CDN fallback
      </div>
      <div id="plot"></div>
    </main>
    <script>
      const traces = {serialized_traces};
      Plotly.newPlot(
        "plot",
        traces,
        {{
          template: "plotly_white",
          hovermode: "x unified",
          margin: {{ l: 64, r: 32, t: 48, b: 64 }},
          legend: {{ orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "left", x: 0 }},
          xaxis: {{ title: "R.Time (min)", showline: true, linewidth: 1, linecolor: "#94a3b8", mirror: true }},
          yaxis: {{ title: "Intensity", showline: true, linewidth: 1, linecolor: "#94a3b8", mirror: true }}
        }},
        {{ responsive: true }}
      );
    </script>
  </body>
</html>
"""


def safe_json_for_script(value: str) -> str:
    return value.replace("</", "<\\/")


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
