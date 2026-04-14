# MVP 要件

## 1. データ登録

- ユーザーは `cwd` 内外のファイルまたはフォルダを `original data` として登録できる
- original data には一意 ID `BLB-...` を付与する
- `1 original data = 1 data note` を基本とする
- data note はユーザーがノート上で参照できる
- original data の data note metadata は frontmatter に持たせ、editor / viewer には本文だけを渡す
- canonical 実体は `.store/` に置く
- metadata は `.store/.integral/{originalDataId}.json` に置く
- file original data の実体は `.store/{originalDataId}{ext}` に置く
- directory original data の実体は `.store/{originalDataId}/` に置く
- `cwd` 外から登録する場合は canonical 実体を `.store` にコピーし、`Data/` に alias を置く
- すでに `cwd` 内にある対象を登録する場合は、canonical 化後も元の path を alias として残す
- metadata には visible alias 用に `aliasRelativePath` を持たせる
- user-facing な path は
  - file は hard link
  - directory は junction
 で alias を残せるようにする

## 2. 処理 block

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
- `inputs / outputs` の値は `datasetId` または `null`

## 3. 処理入出力

- 内部契約は `1 input slot = 1 dataset`
- 内部契約は `1 output slot = 1 dataset`
- GUI 上だけ、`1 input slot = N original data items` を許容する
- `N original data items` を選んだ場合、app は source dataset を新規作成する
- source dataset の実体も `.store/{datasetId}/` に materialize する
- source dataset 内では custom manifest を置かず、普通の file / directory 群として見えるようにする
- source dataset 作成時は
  - file original data は hard link
  - directory original data は junction
  を使う

## 4. Python 汎用解析

- `general-analysis` plugin を用意する
- `general-analysis` plugin は `cwd/.py-scripts/` を走査して block-type を動的生成する
- 各 script 資産は `PYS-...` ID を持つ
- `block-type` はそのまま `PYS-...` を使う
- Python block の `params` は MVP では常に `{}` とする

## 5. Python script 登録

- ユーザーは任意の `.py` を選んで script 資産として登録できる
- 登録時に entry file を選ぶ
- 登録時に同梱するファイルを選ぶ
- 同階層の `.py` は自動同梱する
- それ以外のファイルは手動で同梱する
- 登録時に input slot 名を決める
- 登録時に output slot 名を決める
- 登録結果は `.py-scripts/PYS-.../` に保存する

## 6. Python 実行

- 実行時には `analysis-args.json` を生成する
- `inputs / outputs` には dataset フォルダの絶対パスを渡す
- output dataset フォルダは app 側で事前作成する
- Python スクリプトは output dataset フォルダへ自由に書き込める
- 成功/失敗判定は exit code のみで行う
- output dataset が空でも「空の結果」として扱う
- dataset フォルダの実体は `.store/{datasetId}/` を正とする

## 7. kind / format

- dataset は `dataset.json.kind` を持つ
- source dataset の `kind` は `source-bundle`
- derived dataset の `kind` は、plugin/script が明示しない限り `block-type.slotName`
- slot 定義は `acceptedKinds` / `producedKind` を表現できる
- ただし MVP では enforcement しない

## 8. 標準表示

- `html`
- `png / jpg / jpeg / svg`
- `txt / md / json / csv`

を標準表示対象とする。

- 表示対象ファイルは拡張子で自動判定する
- renderable ファイルが複数ある場合は、すべて flex-layout で表示する

## 9. 可視化 plugin

- 可視化 plugin は、非閲覧データを renderable ファイルへ変換する処理 plugin とする
- 「結果を出してその場で表示する」責務は処理 block に直接持たせない
- 結果を見たい場合は、標準表示 block または可視化 block を別に置く

## 10. 装置 plugin

- 装置 plugin も共通 block schema を使う
- 必要なら custom UI を持てる
- 装置 plugin も dataset を input に取り、dataset を output にできる

## 11. Provenance

- すべての dataset は `.store/.integral/{datasetId}.json` を持つ
- derived dataset には `createdByBlockId` を持たせる
- source dataset では `createdByBlockId` は `null` でよい
- source dataset では provenance 用に source member 情報を metadata に持たせる

## 12. GC

- dataset は immutable
- 再実行時は新しい output dataset を作る
- block の `outputs` は最新 dataset へ更新する
- どこからも参照されない古い dataset は GC 対象にする

