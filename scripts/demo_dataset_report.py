from __future__ import annotations

import csv
import html
import json
import sys
from pathlib import Path
from typing import Any

SDK_IMPORT_ROOT = Path(__file__).resolve().parents[1] / ".integral-sdk" / "python"
if SDK_IMPORT_ROOT.exists():
    sys.path.insert(0, str(SDK_IMPORT_ROOT))

from integral import integral_block


@integral_block(
    display_name="Dataset Report Demo",
    description="Summarize files in one input bundle and emit a small report bundle.",
    inputs=[
        {"name": "source", "extensions": [".idts"], "datatype": "demo/source-bundle"},
    ],
    outputs=[
        {"name": "report", "extension": ".idts", "datatype": "demo/report-bundle"},
    ],
)
def main(inputs: dict[str, str | None], outputs: dict[str, str | None], params: dict[str, Any] | None) -> None:
    source_root = require_existing_directory(inputs, "source")
    report_root = require_output_directory(outputs, "report")
    options = params or {}
    title = str(options.get("title") or "Dataset Report")
    max_rows = coerce_positive_int(options.get("max_rows"), default=200)

    files: list[dict[str, Any]] = []
    total_bytes = 0

    for file_path in sorted(candidate for candidate in source_root.rglob("*") if candidate.is_file()):
        relative_path = file_path.relative_to(source_root).as_posix()
        size = file_path.stat().st_size
        total_bytes += size
        files.append(
            {
                "path": relative_path,
                "size": size,
                "suffix": file_path.suffix.lower()
            }
        )

    report_root.mkdir(parents=True, exist_ok=True)

    summary = {
        "title": title,
        "input_root": str(source_root),
        "file_count": len(files),
        "total_bytes": total_bytes,
        "params": options,
    }

    (report_root / "summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    write_csv(report_root / "files.csv", files)
    (report_root / "README.txt").write_text(
        build_text_report(title, summary, files, max_rows),
        encoding="utf-8",
    )
    (report_root / "index.html").write_text(
        build_html_report(title, summary, files, max_rows),
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


def coerce_positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default

    return parsed if parsed > 0 else default


def write_csv(target_path: Path, files: list[dict[str, Any]]) -> None:
    with target_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["path", "size", "suffix"])

        for entry in files:
            writer.writerow([entry["path"], entry["size"], entry["suffix"]])


def build_text_report(
    title: str,
    summary: dict[str, Any],
    files: list[dict[str, Any]],
    max_rows: int,
) -> str:
    lines = [
        title,
        "=" * len(title),
        f"Input root: {summary['input_root']}",
        f"File count: {summary['file_count']}",
        f"Total bytes: {summary['total_bytes']}",
        "",
        "Files:",
    ]

    for entry in files[:max_rows]:
        lines.append(f"- {entry['path']} ({entry['size']} bytes)")

    if len(files) > max_rows:
        lines.append(f"- ... {len(files) - max_rows} more files")

    return "\n".join(lines) + "\n"


def build_html_report(
    title: str,
    summary: dict[str, Any],
    files: list[dict[str, Any]],
    max_rows: int,
) -> str:
    rows = "\n".join(
        (
            "          <tr>"
            f"<td>{html.escape(str(entry['path']))}</td>"
            f"<td>{html.escape(str(entry['suffix'] or '-'))}</td>"
            f"<td>{entry['size']}</td>"
            "</tr>"
        )
        for entry in files[:max_rows]
    )

    more_notice = (
        f"<p class='notice'>{len(files) - max_rows} more files are omitted.</p>"
        if len(files) > max_rows
        else ""
    )

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>{html.escape(title)}</title>
    <style>
      :root {{
        color-scheme: light;
        font-family: "Segoe UI", sans-serif;
      }}

      body {{
        margin: 0;
        padding: 24px;
        background: #f5f7fa;
        color: #1f2937;
      }}

      .card {{
        max-width: 960px;
        margin: 0 auto;
        padding: 24px;
        border: 1px solid #d9e1ea;
        border-radius: 16px;
        background: #ffffff;
        box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      }}

      .stats {{
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 12px;
        margin: 20px 0 24px;
      }}

      .stat {{
        padding: 14px 16px;
        border-radius: 12px;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
      }}

      .stat-label {{
        display: block;
        margin-bottom: 4px;
        font-size: 12px;
        color: #64748b;
        text-transform: uppercase;
      }}

      .stat-value {{
        font-size: 20px;
        font-weight: 700;
      }}

      table {{
        width: 100%;
        border-collapse: collapse;
      }}

      th,
      td {{
        padding: 10px 12px;
        border-bottom: 1px solid #e5e7eb;
        text-align: left;
        vertical-align: top;
      }}

      th {{
        font-size: 12px;
        color: #64748b;
        text-transform: uppercase;
      }}

      code {{
        display: inline-block;
        padding: 2px 6px;
        border-radius: 999px;
        background: #eff6ff;
        color: #1d4ed8;
      }}

      .notice {{
        margin-top: 12px;
        color: #64748b;
      }}
    </style>
  </head>
  <body>
    <main class="card">
      <p><code>scripts/demo_dataset_report.py:main</code></p>
      <h1>{html.escape(title)}</h1>
      <p>{html.escape(str(summary["input_root"]))}</p>

      <section class="stats">
        <div class="stat">
          <span class="stat-label">Files</span>
          <strong class="stat-value">{summary["file_count"]}</strong>
        </div>
        <div class="stat">
          <span class="stat-label">Bytes</span>
          <strong class="stat-value">{summary["total_bytes"]}</strong>
        </div>
        <div class="stat">
          <span class="stat-label">Rendered Rows</span>
          <strong class="stat-value">{min(len(files), max_rows)}</strong>
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>Suffix</th>
            <th>Bytes</th>
          </tr>
        </thead>
        <tbody>
{rows}
        </tbody>
      </table>

      {more_notice}
    </main>
  </body>
</html>
"""
