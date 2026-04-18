# Managed File と Slot I/O 再設計

## 目的

PoC 段階の IntegralNotes を、`original data / dataset` 中心モデルから、

- `managed file`
- `format`
- `path-based slot I/O`
- `optional bundle (.idts)`

中心モデルへ寄せる。

## 背景

現状の `1 slot = 1 dataset` は実装上は一貫しているが、ユーザーから見ると直感的ではない。

特に次が問題になる。

- 単一 file を渡したいだけでも dataset を意識する必要がある
- ID と `.idts` が前面に出て、普通の file 操作感から離れる
- `original data` と `dataset` の二分法が実利用よりもモデル都合に寄りやすい

一方、ID 追跡自体は有用なので、捨てるべきなのは ID ではなく概念整理である。

## 再設計の中核

### 1. すべての通常 file を managed にする

- `.store/` など system-managed path を除く workspace file は managed file にできる
- `.md` も含める
- identity は `id + path/hash tracking` で持つ

### 2. `dataset` を universal から optional に下げる

- `.idts` は bundle が必要なときだけ使う
- 単一 file 入出力は、そのまま path で扱う
- `1 slot = 1 path` を MVP の基本契約にする

### 3. 生成物の最小メタを削る

generated file が最低限持つべき情報は次だけでよい。

- `createdByBlockId`
- `formatId`

`provenance` enum は必須にしない。

### 4. Markdown source は path 記法のままにする

- `[label](path)` / `![](path)` はそのまま使う
- 内部 relation だけ ID ベースで持つ
- 外部 rename / move を追跡できた場合は、path 記法の source を rewrite する

## Logical Schema

### managed_file

- `id`
- `path`
- `hash`
- `format_id`
- `created_by_block_id`

optional:

- `created_at`
- `bundle_root_path`
- `display_name`

### format

- `id`
- `name`
- `description`

### block

- `id`
- `plugin`
- `block_type`
- `params_json`

### block_io

- `block_id`
- `slot_name`
- `direction` (`input` / `output`)
- `path`

### bundle_member

- `bundle_id`
- `member_id`
- `member_order`

SQLite へ寄せる場合はこの形が自然。  
PoC の first slice では per-file JSON metadata でもよい。

## Slot 定義

MVP の canonical 例:

```python
inputs=[
    {"name": "samples", "extensions": [".csv"], "format": "table/csv"},
    {"name": "source", "extensions": [".idts"], "format": "bundle/idts"},
]
outputs=[
    {"name": "score", "extension": ".csv", "format": "table/pca-score"},
    {"name": "report", "extension": ".html", "format": "report/html"},
]
```

意味:

- `name`
  - slot 識別子
- `extensions`
  - input で受けられる suffix
- `extension`
  - output で生成する suffix
- `format`
  - semantic type

`many` input は direct に `list[path]` を渡すより、PoC では `.idts` bundle へ束ねる方が単純。

## `.idts` の扱い

`.idts` は見た目は普通の workspace file にする。  
ただし runtime では hidden bundle directory に resolve する。

### input

- ユーザーが指定するのは `/Data/samples.idts`
- Python に渡すのは `.store/objects/<id>/`

### output

- ユーザーが指定するのは `/Results/output.idts`
- app は hidden bundle directory を確保する
- Python に hidden bundle directory path を渡す
- 実行後、visible `.idts` manifest を保存する

## Link / Embed rewrite

`path -> id` は identity 決定ではなく current index として持つ。  
tracked rename / move が確定したら、少なくとも次を scan して old path を new path に置換する。

- Markdown link
- Markdown image
- `itg-notes` block source

PoC では全 scan でよい。  
後で reverse index を入れれば高速化できる。

## 実装段階

### Phase 1

- 文書更新
- Issue 化
- Python SDK の slot schema 拡張
- discovery parser の object form 対応
- runner の file path / `.idts` path 混在対応

### Phase 2

- renderer の input picker を file path 中心へ変更
- output path editor を exact path 中心へ変更
- managed file catalog を `original data / dataset` から generic へ寄せる

### Phase 3

- metadata backend を SQLite へ移行
- reverse relation index を追加
- GC と graph viewer をこのモデルへ合わせる

## 非目標

最初の実装では次を同時にやらない。

- Markdown source の ID 記法化
- 全 viewer / plugin 契約の同時再設計
- 完全な migration 層
- 既存 PoC データの完全互換
