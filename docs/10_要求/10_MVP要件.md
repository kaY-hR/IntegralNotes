# MVP 要件

## 1. データ登録

- ユーザーはファイルまたはフォルダを `blob` として登録できる
- blob には一意 ID `BLB-...` を付与する
- `1 blob = 1 artifact note` を基本とする
- artifact note はユーザーがノート上で参照できる

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
- `inputs / outputs` の値は `chunkId` または `null`

## 3. 処理入出力

- 内部契約は `1 input slot = 1 chunk`
- 内部契約は `1 output slot = 1 chunk`
- GUI 上だけ、`1 input slot = N blobs` を許容する
- `N blobs` を選んだ場合、app は source chunk を新規作成する

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
- `inputs / outputs` には chunk フォルダの絶対パスを渡す
- output chunk フォルダは app 側で事前作成する
- Python スクリプトは output chunk フォルダへ自由に書き込める
- 成功/失敗判定は exit code のみで行う
- output chunk が空でも「空の結果」として扱う

## 7. kind / format

- chunk は `chunk.json.kind` を持つ
- source chunk の `kind` は `source-bundle`
- derived chunk の `kind` は、plugin/script が明示しない限り `block-type.slotName`
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
- 装置 plugin も chunk を input に取り、chunk を output にできる

## 11. Provenance

- すべての chunk は `chunk.json` を持つ
- derived chunk には `createdByBlockId` を持たせる
- source chunk では `createdByBlockId` は `null` でよい

## 12. GC

- chunk は immutable
- 再実行時は新しい output chunk を作る
- block の `outputs` は最新 chunk へ更新する
- どこからも参照されない古い chunk は GC 対象にする
