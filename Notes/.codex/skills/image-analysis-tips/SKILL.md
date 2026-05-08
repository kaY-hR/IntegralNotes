---
name: image-analysis-tips
description: "Use when giving tips for analyzing image files, such as PNG, JPEG, WebP, TIFF, or other raster formats, or when explaining how to use Python imaging libraries such as Pillow, OpenCV, scikit-image, or imageio in an IntegralNotes block."
---

## Tips1: cv2.imread() on Windows does not support paths with Japanese characters

Windows上で `cv2.imread()` は日本語を含むパスを読み込めない。`np.fromfile()` でバイト列として読み込み `cv2.imdecode()` でデコードする。