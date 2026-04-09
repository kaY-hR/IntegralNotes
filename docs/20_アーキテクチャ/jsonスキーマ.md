## jsonスキーマ

* 独自UI block は Markdown 上では ```` ```itg-notes ```` の中に JSON 文字列として保存する。
* `itg-notes` JSON を block の唯一の正とし、plugin 専用 GUI の編集結果も最終的にはこの JSON に反映する。
* `type` は plugin namespace を先頭に持つ block 識別子とする。
* `version` は block JSON 自体の schema version であり、plugin package version とは分けて扱う。
* `params` は block 固有パラメータを入れる。
* plugin renderer が直接変更する対象は当面 `params` を基本とし、`type` などの top-level は app 側が保持する。
* plugin manifest 側のルールは `docs\20_アーキテクチャ\pluginシステム.md` を参照する。

```jsonc
{
  "type": "LC.Method.Gradient",
  "version": "1.0.0",
  "description": "optional",
  "params": {
    "analysis-time": 8,
    "time-prog": [
      { "time": 0, "Conc": 10 },
      { "time": 8, "Conc": 100 }
    ]
  }
}
```

* `type` が未登録でもノートは開けるようにし、UI は generic preview へフォールバックする。
