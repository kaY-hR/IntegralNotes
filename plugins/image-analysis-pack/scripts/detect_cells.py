from __future__ import annotations

import math
import sys
from pathlib import Path
from typing import Any


# Allow direct execution outside the app (IDE / command-line)
def _find_sdk(start: Path) -> Path | None:
    for parent in (start.parent, *start.parents):
        candidate = parent / ".integral-sdk" / "python"
        if candidate.exists():
            return candidate
    return None


def _find_package_shared(start: Path) -> Path | None:
    for parent in (start.parent, *start.parents):
        candidate = parent / "shared"
        if (parent / "integral-package.json").exists() and candidate.exists():
            return candidate
    return None


_sdk = _find_sdk(Path(__file__).resolve())
if _sdk:
    sys.path.insert(0, str(_sdk))

_package_shared = _find_package_shared(Path(__file__).resolve())
if _package_shared:
    sys.path.insert(0, str(_package_shared))

import numpy as np
from integral import integral_block
from integral_image_compare import make_layer, write_manifest


def _cv2_imread_unicode(path: str | Path) -> "np.ndarray":
    """Read an image from a path that may contain non-ASCII (e.g. Japanese) characters."""
    import cv2

    buf = np.fromfile(str(path), dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise FileNotFoundError(f"cv2 could not decode image: {path}")
    return img


def _cv2_imwrite_unicode(path: str | Path, img: "np.ndarray") -> None:
    """Write an image to a path that may contain non-ASCII characters."""
    import cv2

    ext = Path(path).suffix.lower()
    ok, buf = cv2.imencode(ext, img)
    if not ok:
        raise RuntimeError(f"cv2.imencode failed for extension '{ext}'")
    np.array(buf).tofile(str(path))


def _clamp_number(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def _make_circle_mask(shape: tuple[int, int], center: tuple[int, int], radius: int) -> "np.ndarray":
    import cv2

    mask = np.zeros(shape, dtype=np.uint8)
    cv2.circle(mask, center, max(int(radius), 1), 255, -1)
    return mask


def _measure_cell(
    *,
    center_x: int,
    center_y: int,
    radius: int,
    gray: "np.ndarray",
    fluor_signal: "np.ndarray",
    magenta_signal: "np.ndarray",
    magenta_threshold: int,
) -> dict[str, float]:
    import cv2

    shape = gray.shape[:2]
    inner_mask = _make_circle_mask(shape, (center_x, center_y), max(radius - 2, 1))
    outer_mask = _make_circle_mask(shape, (center_x, center_y), radius + 3)
    annulus_mask = cv2.subtract(outer_mask, inner_mask)

    mean_fluor = float(cv2.mean(fluor_signal, mask=inner_mask)[0])
    mean_magenta = float(cv2.mean(magenta_signal, mask=inner_mask)[0])
    mean_gray_inner = float(cv2.mean(gray, mask=inner_mask)[0])
    mean_gray_annulus = float(cv2.mean(gray, mask=annulus_mask)[0])

    positive_mask = ((magenta_signal >= magenta_threshold) & (inner_mask > 0)).astype(np.uint8)
    positive_pixels = int(positive_mask.sum())
    total_pixels = max(cv2.countNonZero(inner_mask), 1)

    return {
        "mean_fluor_intensity": mean_fluor,
        "mean_magenta_intensity": mean_magenta,
        "gray_edge_contrast": abs(mean_gray_annulus - mean_gray_inner),
        "positive_area_fraction": float(positive_pixels) / float(total_pixels),
    }


def _detect_hough_candidates(
    *,
    source: "np.ndarray",
    min_radius: int,
    max_radius: int,
    hough_param1: float,
    hough_param2: float,
    min_distance: float,
    method: str,
) -> list[dict[str, Any]]:
    import cv2

    blurred = cv2.GaussianBlur(source, (9, 9), 2)
    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1,
        minDist=min_distance,
        param1=hough_param1,
        param2=hough_param2,
        minRadius=min_radius,
        maxRadius=max_radius,
    )

    if circles is None:
        return []

    candidates: list[dict[str, Any]] = []
    for cx, cy, cr in np.round(circles[0]).astype(int):
        candidates.append(
            {
                "x": int(cx),
                "y": int(cy),
                "radius_px": int(cr),
                "method": method,
            }
        )

    return candidates


def _deduplicate_candidates(
    candidates: list[dict[str, Any]],
    *,
    min_radius: int,
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: float(item.get("score", 0.0)), reverse=True):
        cx = int(candidate["x"])
        cy = int(candidate["y"])
        cr = int(candidate["radius_px"])

        if any(
            math.hypot(cx - int(item["x"]), cy - int(item["y"]))
            < max(min_radius * 0.9, min(cr, int(item["radius_px"])) * 0.9)
            for item in selected
        ):
            continue

        selected.append(candidate)

    return selected


def _add_fluorescent_blob_candidates(
    *,
    candidates: list[dict[str, Any]],
    magenta_signal: "np.ndarray",
    threshold: int,
    min_radius: int,
    max_radius: int,
    seed_radius: int,
) -> None:
    import cv2

    _, binary = cv2.threshold(magenta_signal, threshold, 255, cv2.THRESH_BINARY)
    kernel = np.ones((3, 3), dtype=np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    seed_radius = int(_clamp_number(seed_radius, min_radius, max_radius))
    min_area = math.pi * (min_radius * 0.35) ** 2
    max_area = math.pi * (seed_radius * 1.45) ** 2

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area or area > max_area:
            continue

        moments = cv2.moments(contour)
        if moments["m00"] == 0:
            continue

        center_x = int(round(moments["m10"] / moments["m00"]))
        center_y = int(round(moments["m01"] / moments["m00"]))
        radius = seed_radius

        has_existing = any(
            math.hypot(center_x - item["x"], center_y - item["y"])
            < max(min_radius * 0.9, min(radius, item["radius_px"]) * 0.85)
            for item in candidates
        )
        if has_existing:
            continue

        candidates.append(
            {
                "x": center_x,
                "y": center_y,
                "radius_px": radius,
                "method": "fluorescence_seed",
                "score": 0.0,
            }
        )


@integral_block(
    display_name="細胞検出",
    description="蛍光顕微鏡画像から細胞（円形領域）を検出し、オーバーレイ画像・CSV結果・比較ビューを出力します。",
    inputs=[
        {
            "name": "image",
            "extensions": [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp"],
            "datatype": "integral/image",
        },
    ],
    outputs=[
        {
            "name": "overlay",
            "extension": ".png",
            "datatype": "integral/image",
        },
        {
            "name": "results",
            "extension": ".csv",
            "datatype": "integral/table",
        },
        {
            "name": "compare_view",
            "extension": ".icv",
            "datatype": "integral/image-compare-view",
            "auto_insert_to_work_note": True,
        },
    ],
    params={
        "type": "object",
        "properties": {
            "channel": {
                "type": "string",
                "title": "検出チャンネル",
                "description": "'fluorescence'=蛍光陽性のみ, 'brightfield'=全細胞(形状のみ), 'both'=全細胞",
                "default": "both",
                "enum": ["fluorescence", "brightfield", "both"],
            },
            "min_radius_px": {
                "type": "integer",
                "title": "最小細胞半径 (px)",
                "description": "検出する細胞の最小半径（ピクセル）",
                "default": 8,
                "minimum": 2,
            },
            "max_radius_px": {
                "type": "integer",
                "title": "最大細胞半径 (px)",
                "description": "検出する細胞の最大半径（ピクセル）",
                "default": 40,
                "minimum": 5,
            },
            "hough_param1": {
                "type": "number",
                "title": "Hough param1",
                "description": "Cannyエッジ検出の上側閾値（大きいほど厳密）",
                "default": 50.0,
                "minimum": 1.0,
            },
            "hough_param2": {
                "type": "number",
                "title": "Hough param2",
                "description": "中心検出の累積閾値（小さいほど多く検出、誤検出も増える）",
                "default": 25.0,
                "minimum": 1.0,
            },
            "fluor_threshold": {
                "type": "integer",
                "title": "蛍光閾値",
                "description": "蛍光陽性判定の平均輝度閾値 (0–255)",
                "default": 30,
                "minimum": 0,
                "maximum": 255,
            },
            "detection_sensitivity": {
                "type": "number",
                "title": "検出感度",
                "description": "大きいほど検出漏れを減らします。誤検出が増える場合は下げてください。",
                "default": 0.7,
                "minimum": 0.0,
                "maximum": 1.0,
            },
            "fluor_blob_threshold": {
                "type": "integer",
                "title": "蛍光領域補完閾値",
                "description": "蛍光領域から検出候補を補完する閾値。0 の場合は画像から自動推定します。",
                "default": 0,
                "minimum": 0,
                "maximum": 255,
            },
            "candidate_max_radius_px": {
                "type": "integer",
                "title": "候補最大半径 (px)",
                "description": "検出候補の最大半径。0 の場合は最小半径から自動推定し、大きすぎる結合円を抑制します。",
                "default": 0,
                "minimum": 0,
                "maximum": 500,
            },
        },
    },
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    import cv2

    # --- inputs ---
    image_path_raw = inputs.get("image")
    if not image_path_raw:
        raise ValueError("入力スロット 'image' が未設定です。")
    image_path = Path(image_path_raw)
    if not image_path.exists():
        raise FileNotFoundError(f"入力画像が見つかりません: {image_path}")

    # --- outputs ---
    overlay_raw = outputs.get("overlay")
    if not overlay_raw:
        raise ValueError("出力スロット 'overlay' が未設定です。")
    overlay_path = Path(overlay_raw)
    overlay_path.parent.mkdir(parents=True, exist_ok=True)

    results_raw = outputs.get("results")
    results_path = Path(results_raw) if results_raw else None
    if results_path:
        results_path.parent.mkdir(parents=True, exist_ok=True)

    compare_raw = outputs.get("compare_view")
    compare_path = Path(compare_raw) if compare_raw else None
    if compare_path:
        compare_path.parent.mkdir(parents=True, exist_ok=True)

    # --- params ---
    opts = params or {}
    channel = str(opts.get("channel") or "both")
    min_r = int(opts.get("min_radius_px") or 8)
    max_r = int(opts.get("max_radius_px") or 40)
    h_param1 = float(opts.get("hough_param1") or 50.0)
    h_param2 = float(opts.get("hough_param2") or 25.0)
    fluor_thr = int(opts.get("fluor_threshold") or 30)
    sensitivity = _clamp_number(float(opts.get("detection_sensitivity", 0.7)), 0.0, 1.0)
    fluor_blob_threshold = int(opts.get("fluor_blob_threshold") or 0)
    candidate_max_radius = int(opts.get("candidate_max_radius_px") or 0)

    # --- load image (Unicode-safe) ---
    bgr = _cv2_imread_unicode(image_path)
    h_img, w_img = bgr.shape[:2]

    b_ch, g_ch, r_ch = cv2.split(bgr)

    # Fluorescence signal: マゼンタ = R + B が強い、G が弱い
    fluor_signal = cv2.max(r_ch, b_ch)
    magenta_signal = cv2.subtract(fluor_signal, g_ch)

    # --- build detection source gray image ---
    gray_full = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    if channel == "fluorescence":
        gray_src = fluor_signal
    elif channel == "brightfield":
        gray_src = gray_full
    else:  # "both"
        gray_src = cv2.addWeighted(gray_full, 0.5, fluor_signal, 0.5, 0)

    # Enhance local contrast with CLAHE
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray_src)
    enhanced_gray = clahe.apply(gray_full)
    enhanced_fluor = clahe.apply(fluor_signal)
    background = cv2.GaussianBlur(gray_full, (0, 0), 25)
    local_contrast = cv2.normalize(
        cv2.absdiff(gray_full, background),
        None,
        0,
        255,
        cv2.NORM_MINMAX,
    ).astype(np.uint8)
    enhanced_local_contrast = clahe.apply(local_contrast)

    # The original single-pass Hough setting missed dim and nearby cells.
    # Use several registered contrast views, then deduplicate. Fluorescence is
    # allowed to add missing centers, but no longer determines large cell radii.
    effective_h_param2 = max(5.0, h_param2 * (1.0 - 0.58 * sensitivity))
    auto_max_r = max(min_r + 10, 18)
    effective_max_r = max(min_r, min(max_r, candidate_max_radius or auto_max_r))
    min_distance = max(float(min_r) * 1.25, 6.0)

    hough_sources: list[tuple[str, np.ndarray, float]] = [
        ("hough_combined", enhanced, 1.0),
        ("hough_brightfield", enhanced_gray, 1.05),
        ("hough_local_contrast", enhanced_local_contrast, 0.9),
    ]
    if channel in {"both", "fluorescence"}:
        hough_sources.append(("hough_fluorescence", enhanced_fluor, 0.95))

    hough_candidates: list[dict[str, Any]] = []
    for method, source, threshold_factor in hough_sources:
        hough_candidates.extend(
            _detect_hough_candidates(
                source=source,
                min_radius=min_r,
                max_radius=effective_max_r,
                hough_param1=h_param1,
                hough_param2=max(5.0, effective_h_param2 * threshold_factor),
                min_distance=min_distance,
                method=method,
            )
        )

    source_bonus = {
        "hough_local_contrast": 5.0,
        "hough_brightfield": 2.0,
        "hough_combined": 1.0,
        "hough_fluorescence": 0.0,
    }
    for candidate in hough_candidates:
        cx = int(candidate["x"])
        cy = int(candidate["y"])
        cr = int(candidate["radius_px"])
        if cx < 0 or cy < 0 or cx >= w_img or cy >= h_img:
            candidate["score"] = -1000.0
            continue

        measurements = _measure_cell(
            center_x=cx,
            center_y=cy,
            radius=cr,
            gray=gray_full,
            fluor_signal=fluor_signal,
            magenta_signal=magenta_signal,
            magenta_threshold=max(1, fluor_thr),
        )
        method = str(candidate["method"])
        candidate["score"] = (
            measurements["gray_edge_contrast"] * 1.5
            + measurements["mean_magenta_intensity"] * 0.08
            + measurements["mean_fluor_intensity"] * 0.02
            + source_bonus.get(method, 0.0)
            - max(0.0, float(cr - 18)) * 0.4
        )

    candidates = _deduplicate_candidates(hough_candidates, min_radius=min_r)
    hough_radii = [int(item["radius_px"]) for item in candidates if int(item["radius_px"]) <= effective_max_r]
    typical_radius = int(np.median(hough_radii)) if hough_radii else max(min_r, 12)
    typical_radius = int(_clamp_number(typical_radius, min_r, min(max_r, 16)))

    if fluor_blob_threshold <= 0:
        fluor_blob_threshold = int(_clamp_number(float(np.percentile(magenta_signal, 98)), 22.0, 80.0))

    if channel in {"both", "fluorescence"}:
        _add_fluorescent_blob_candidates(
            candidates=candidates,
            magenta_signal=magenta_signal,
            threshold=fluor_blob_threshold,
            min_radius=min_r,
            max_radius=effective_max_r,
            seed_radius=typical_radius,
        )

    # --- classify, filter impossible candidates, and draw ---
    detections: list[dict[str, Any]] = []
    overlay = bgr.copy()

    for candidate in candidates:
        cx = int(candidate["x"])
        cy = int(candidate["y"])
        cr = int(candidate["radius_px"])
        if cx < 0 or cy < 0 or cx >= w_img or cy >= h_img:
            continue

        measurements = _measure_cell(
            center_x=cx,
            center_y=cy,
            radius=cr,
            gray=gray_full,
            fluor_signal=fluor_signal,
            magenta_signal=magenta_signal,
            magenta_threshold=fluor_blob_threshold,
        )

        mean_fluor = measurements["mean_fluor_intensity"]
        mean_magenta = measurements["mean_magenta_intensity"]
        positive_area_fraction = measurements["positive_area_fraction"]
        is_fluor = (
            mean_fluor >= fluor_thr
            and (mean_magenta >= max(5.0, fluor_thr * 0.25) or positive_area_fraction >= 0.08)
        )

        color = (255, 0, 255) if is_fluor else (160, 160, 160)
        label = "positive" if is_fluor else "negative"

        cv2.circle(overlay, (cx, cy), cr, color, 2)
        cv2.circle(overlay, (cx, cy), 2, color, -1)

        detections.append(
            {
                "x": cx,
                "y": cy,
                "radius_px": cr,
                "mean_fluor_intensity": round(mean_fluor, 2),
                "mean_magenta_intensity": round(mean_magenta, 2),
                "positive_area_fraction": round(positive_area_fraction, 4),
                "gray_edge_contrast": round(measurements["gray_edge_contrast"], 2),
                "fluorescence": label,
                "method": candidate["method"],
            }
        )

    # --- write overlay ---
    _cv2_imwrite_unicode(overlay_path, overlay)

    # --- write CSV ---
    if results_path:
        lines = [
            "x,y,radius_px,mean_fluor_intensity,mean_magenta_intensity,"
            "positive_area_fraction,gray_edge_contrast,fluorescence,method"
        ]
        for d in detections:
            lines.append(
                f"{d['x']},{d['y']},{d['radius_px']}"
                f",{d['mean_fluor_intensity']},{d['mean_magenta_intensity']}"
                f",{d['positive_area_fraction']},{d['gray_edge_contrast']}"
                f",{d['fluorescence']},{d['method']}"
            )
        n_pos = sum(1 for d in detections if d["fluorescence"] == "positive")
        n_neg = len(detections) - n_pos
        lines.append(f"# 合計: {len(detections)} 個  蛍光陽性: {n_pos}  蛍光陰性: {n_neg}")
        results_path.write_text("\n".join(lines), encoding="utf-8")

    # --- write compare_view (.icv) ---
    if compare_path:
        write_manifest(
            compare_path,
            [
                make_layer(
                    image_path,
                    manifest_path=compare_path,
                    layer_id="source",
                    label="元画像",
                ),
                make_layer(
                    overlay_path,
                    manifest_path=compare_path,
                    layer_id="overlay",
                    label="検出オーバーレイ",
                    opacity=0.8,
                ),
            ],
            name="細胞検出 比較ビュー",
        )

    # --- summary ---
    n_total = len(detections)
    n_pos = sum(1 for d in detections if d["fluorescence"] == "positive")
    print(
        "Detection complete: "
        f"total={n_total}, fluorescence_positive={n_pos}, "
        f"fluorescence_negative={n_total - n_pos}, "
        f"effective_hough_param2={effective_h_param2:.2f}, "
        f"fluor_blob_threshold={fluor_blob_threshold}"
    )
