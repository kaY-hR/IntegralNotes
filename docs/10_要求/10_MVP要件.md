# MVP 要件

## 1. 管理対象ファイル

- `cwd` 内の通常 file は、`.store/` などの system-managed path を除き managed file として扱う
- `.md` も managed file に含める
- ID prefix 自体は implementation detail とし、stable identity を持てばよい
- すべての managed file は少なくとも次の metadata を持つ
  - `id`
  - `path`
  - `hash`
  - `formatId`
  - `createdByBlockId`
- `path` は current canonical workspace relative path とする
- `hash` は current content identity とする
- metadata の物理実装は JSON file でも SQLite でもよいが、logical model は共通とする
- 起動時または Sync 時には `cwd` を scan し、未管理の workspace file を managed file として取り込めるようにする
- 自動登録では hidden path、system-managed path、既存 managed path と衝突する path は除外する
- path / hash tracking は少なくとも次を満たす
  - `path same + hash same`: 変更なし
  - `path changed + hash same`: rename / move
  - `path same + hash changed`: 内容更新
  - `path changed + hash changed`: 候補が一意なら追跡し、曖昧なら confirm

## 2. Data Note

- `.md` を除く managed file と dataset に data-note を持たせる
- data-note は `.store/.integral/data-notes/{id}.md` に置く system-managed Markdown とする
- app は data-note を file path ではなく target ID で開く
- ユーザーは data-note の本文だけを編集できる
- data-note 対象の managed data を管理対象から外したときは、対応する metadata と data-note も削除する

## 3. Markdown Note

- `cwd` 配下の `.md` は managed file として追跡する
- `.md` managed file 自体には data-note を作らない
- frontmatter がある場合、app は frontmatter を保持し、editor / viewer には本文だけを渡す
- 保存時は本文だけを更新し、frontmatter は壊さず保持する
- `見たまま編集` と `body-only raw text` を切り替えられる

## 4. Format

- format は managed file とは別の registry で管理する
- MVP の format は少なくとも次を持つ
  - `id`
  - `name`
  - `description`
- 例:
  - `table/csv`
  - `chromatogram/json`
  - `bundle/idts`
  - `report/html`

## 5. 処理 Block

すべての block は次の共通キーを持つ。

- `id`
- `plugin`
- `block-type`
- `params`
- `inputs`
- `outputs`

補足:

- `id` は `BLK-...`
- app は `id` がなければ自動補完する
- `inputs / outputs` は slot 名を key に持つ
- `inputs / outputs` の値は workspace relative path または `null`
- user-facing な `itg-notes` block source は YAML のみを受け付ける
- `itg-notes` block では `use:` または `run:` の簡易記法を canonical form とする
- `run: relative/path.py:function` は内部で `plugin = "general-analysis"` とその callable block-type へ正規化する

## 6. Slot 契約

- slot は少なくとも次を定義できる
  - `name`
  - `extension` または `extensions`
  - `format`
- input slot では `extensions` によって選択可能な file suffix を表せる
- output slot では `extension` によって生成される file suffix を表せる
- `format` は slot が意味的に扱う file type を表す
- MVP の基本契約は `1 slot = 1 path` とする
- 複数 file を 1 slot で扱いたい場合は `.idts` bundle を使う

## 7. Bundle (`.idts`)

- `.idts` は「複数 file を束ねる optional な集合表現」とする
- `.idts` 自体は workspace 上の visible file とする
- `.idts` が指す中身は `.store/objects/{id}/` の hidden directory に置いてよい
- `.idts` manifest には少なくとも次を持てる
  - `id`
  - `name`
  - `formatId`
  - `bundleRootPath`
  - `memberIds`
- 1 file が複数 bundle に所属できる
- `.idts` は universal な I/O 単位ではなく、bundle が必要な場合にだけ使う

## 8. Python 汎用解析

- `general-analysis` plugin を用意する
- `general-analysis` plugin は `cwd` 配下の `.py` を走査し、decorator 付き関数を block-type 候補として動的生成する
- Python callable の canonical ID は `relative/path.py:function` とする
- `block-type` はその canonical callable string を使う
- Python block の `params` は free-form object とし、schema enforcement はしない

## 9. Python Callable Discovery

- ユーザー管理の `.py` file 自体を source of truth とする
- app は decorator 付き関数から `displayName`, `description`, `inputSlots`, `outputSlots` を読む
- slot 定義は string shorthand でも object form でもよい
- object form の canonical 例:

```python
@integral_block(
    display_name="PCA",
    description="CSV から PCA を計算する",
    inputs=[
        {"name": "samples", "extensions": [".csv"], "format": "table/csv"}
    ],
    outputs=[
        {"name": "score", "extension": ".csv", "format": "table/pca-score"},
        {"name": "report", "extension": ".html", "format": "report/html"},
    ],
)
```

- editor 上で `>` を入力すると Python callable 候補 popup を表示できる
- 候補一覧では `displayName` を主表示し、`relative/path.py:function` を補助表示する
- 候補選択時には `run:` を持つ YAML `itg-notes` block を note へ挿入する
- `.py` file や補助 file を app 側の専用ディレクトリへ copy しない
- MVP の scan 契約は `@integral_block(...)` の直後に `def ...(` が続く形とする

## 10. Python 実行

- 実行時には `analysis-args.json` を生成する
- `inputs / outputs` には Python がそのまま使える絶対 path を渡す
- 非 `.idts` input は、指定された file path をそのまま渡す
- `.idts` input は hidden bundle directory へ resolve した path を渡す
- 非 `.idts` output は、指定された output file path をそのまま渡す
- `.idts` output は、visible manifest path と hidden bundle directory を app 側で事前に確保し、Python には hidden bundle directory path を渡す
- `params` は note source から読んだ object をそのまま渡す
- runner は `analysis-args.json` を読んで target callable を `inputs`, `outputs`, `params` 引数で呼び出す
- 成功/失敗判定は exit code のみで行う
- 実行成功後は output path に対応する managed file metadata を作成または更新する
- generated file が持つべき最低限の情報は `createdByBlockId` と `formatId` でよい
- 実行時の current working directory は workspace root を基本とする
- `analysis-args.json` や log は `.store/.integral/runtime/` 配下へ置いてよい

## 11. 標準表示

- `htm / html`
- `bmp / gif / jpg / jpeg / png / svg / webp`
- `bat / c / css / csv / env / ini / js / json / log / md / mjs / ps1 / py / sh / sql / toml / ts / tsx / tsv / txt / xml / yaml / yml`
- `.idts`

を標準表示対象とする。

- 表示対象 file は拡張子で自動判定する
- 拡張子未登録でも text と読める file は text viewer で扱ってよい
- `.idts` は bundle manifest viewer と bundle preview の両方を持てる

## 12. 装置 Plugin

- 装置 plugin も共通 block schema を使う
- 必要なら custom UI を持てる
- 装置 plugin も path-based slot 契約を使う

## 13. Tracking と参照更新

- managed file の identity は path ではなく ID と hash で追う
- path 変更を追跡できた場合、app は参照元 text file を scan して old path を new path へ書き換えてよい
- 少なくとも Markdown link / image と block source の path 参照は更新対象に含める
- `path -> id` は current lookup index として持てるが、identity の source of truth ではない

## 14. ノート内 Link / Image

- 通常 note 本文では標準 Markdown link `[label](target)` を使って workspace 内 file へ link できる
- 通常 note 本文では標準 Markdown image 記法 `![alt](target)` を使って画像や workspace file を埋め込める
- 記法自体は path ベースのままとし、ID 記法にはしない
- 外部 rename / move を追跡できた場合も、app は path 記法の source を更新する

## 15. GC

- block 実行で作られる hidden bundle directory や runtime log は GC 対象にできる
- user-facing workspace file 自体は app が勝手に消さない
- 再実行で不要になった旧 bundle は、どこからも参照されなければ GC 対象にできる
