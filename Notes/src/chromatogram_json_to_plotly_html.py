from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from integral import integral_block


@integral_block(
    display_name="Chromatogram JSON To Plotly HTML",
    description="Render an overlaid chromatogram plot from one chromatogram JSON file.",
    inputs=[
        {"name": "source", "extensions": [".json"], "format": "chromatogram/json"},
    ],
    outputs=[
        {"name": "plot", "extension": ".html", "format": "report/html"},
    ],
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    source_path = require_existing_file(inputs, "source")
    output_path = require_output_file(outputs, "plot")
    options = params or {}
    title = str(options.get("title") or "LC Chromatograms Overlay")
    line_width = coerce_positive_float(options.get("line_width"), default=1.5)
    height = coerce_positive_int(options.get("height"), default=720)
    traces = load_traces(source_path)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        build_plot_html(
            title=title,
            json_name=source_path.name,
            traces=traces,
            line_width=line_width,
            height=height,
        ),
        encoding="utf-8",
    )


def require_existing_file(values: dict[str, str | None], slot_name: str) -> Path:
    candidate = (values or {}).get(slot_name)
    if not candidate:
        raise ValueError(f"Input slot '{slot_name}' is required.")

    file_path = Path(candidate)
    if not file_path.exists():
        raise FileNotFoundError(f"Input path does not exist: {file_path}")
    if not file_path.is_file():
        raise FileNotFoundError(f"Input path is not a file: {file_path}")

    return file_path


def require_output_file(values: dict[str, str | None], slot_name: str) -> Path:
    candidate = (values or {}).get(slot_name)
    if not candidate:
        raise ValueError(f"Output slot '{slot_name}' is required.")

    return Path(candidate)


def load_traces(json_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(json_path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict) or not payload:
        raise ValueError(f"Expected a non-empty object in {json_path}")

    traces: list[dict[str, Any]] = []

    for raw_name, raw_series in payload.items():
        series_name = str(raw_name)
        if not isinstance(raw_series, dict):
            raise ValueError(f"Expected '{series_name}' to be an object in {json_path}")

        raw_rt = raw_series.get("rt")
        raw_intensity = raw_series.get("intesity")
        if raw_intensity is None:
            raw_intensity = raw_series.get("intensity")

        if not isinstance(raw_rt, list):
            raise ValueError(f"Expected '{series_name}.rt' to be a list in {json_path}")
        if not isinstance(raw_intensity, list):
            raise ValueError(f"Expected '{series_name}.intesity' to be a list in {json_path}")
        if len(raw_rt) != len(raw_intensity):
            raise ValueError(
                f"Expected '{series_name}.rt' and '{series_name}.intesity' to have the same length in {json_path}"
            )
        if not raw_rt:
            raise ValueError(f"Expected '{series_name}' to contain at least one point in {json_path}")

        traces.append(
            {
                "name": series_name,
                "x": [coerce_number(value, series_name=series_name, axis_name="rt") for value in raw_rt],
                "y": [coerce_number(value, series_name=series_name, axis_name="intesity") for value in raw_intensity],
            }
        )

    return traces


def coerce_number(value: Any, *, series_name: str, axis_name: str) -> float:
    try:
        return float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Expected numeric values in '{series_name}.{axis_name}', got {value!r}") from error


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
