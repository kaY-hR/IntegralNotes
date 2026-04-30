---
name: implement-integral-block
description: IntegralNotes の Python 解析 block を実装するためのルール
---

IntegralNotes の Python 解析 block は、workspace 内の `.py` file に `@integral_block(...)` を付けた top-level callable として実装する。

必須ルール:

- `from integral import integral_block` を使う。
- `@integral_block(...)` は `def main(inputs, outputs, params) -> None:` の直上に置く。
- `inputs` と `outputs` は slot 名から path への dict として扱う。
- 出力は必ず `outputs` で渡された path に書く。
- 解析間で再利用する I/O 互換性ラベルは slot の `datatype` に書く。設定済みのユーザーIDが分かる場合は `{user-id}/名前` の形を推奨する。
- user-facing renderable は HTML、画像、Markdown/text などの専用 output slot に分ける。
- user-facing renderable を block 直下に表示したい場合は `auto_insert_to_work_note=True` を付ける。
- CSV/TSV/JSON などの機械可読・中間成果物は、表示用 output と分ける。
- 複数 file を同じ役割の1セットとして出す場合だけ `.idts` output を使う。
- `.idts` output の `outputs[slot名]` は directory path として渡される。Python はその directory 内に構成 file を作り、`.idts` manifest は作らない。

`params` ルール:

- user-editable parameter は `@integral_block(..., params={...})` に Python literal の JSON Schema subset として定義する。
- `params` schema は root `{"type": "object", "properties": {...}}` のみ使う。
- property の `type` は `string`、`number`、`integer`、`boolean` のみ使う。
- UI metadata として `title`、`description`、`default`、`enum`、`minimum`、`maximum` を使える。
- `default` が無い property は block の `params:` では `null` 初期値になる。
- decorator に無い param、未対応型の param、schema 外の YAML param は app によって削除される。

例:

```python
from __future__ import annotations

from typing import Any

from integral import integral_block


@integral_block(
    display_name="PCA",
    description="CSV から PCA を計算する",
    inputs=[
        {"name": "samples", "extensions": [".csv"], "datatype": "user-id/sample-table"},
    ],
    outputs=[
        {
            "name": "report",
            "extension": ".html",
            "datatype": "user-id/pca-report",
            "auto_insert_to_work_note": True,
        },
    ],
    params={
        "type": "object",
        "properties": {
            "n_components": {
                "type": "integer",
                "title": "主成分数",
                "description": "計算する主成分の数",
                "default": 2,
                "minimum": 1,
            },
            "scale": {
                "type": "boolean",
                "title": "標準化",
                "default": True,
            },
            "method": {
                "type": "string",
                "title": "手法",
                "enum": ["pca", "kernel-pca"],
                "default": "pca",
            },
        },
    },
)
def main(
    inputs: dict[str, str | None],
    outputs: dict[str, str | None],
    params: dict[str, Any] | None,
) -> None:
    effective_params = params or {}
    n_components = int(effective_params.get("n_components") or 2)
    scale = bool(effective_params.get("scale"))
    method = str(effective_params.get("method") or "pca")
    del inputs, outputs, n_components, scale, method
```
