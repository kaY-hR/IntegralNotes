## [ ] 1. 表示の拡大縮小
- Status:in-progress
- 優先重み:5
- 記載日時:?

* ctrl+'-'で表示縮小できるのに、ctrl+'+'で拡大が出来ないため、一回縮小するとそれ以上拡大できなくなる
* ピンチアウトやホイールズームでも拡縮ができると望ましい

## [-] 2. スラッシュコマンドメニューが残る
- 優先重み:2
- 記載日時:?

スラッシュを打った状態でスラッシュコマンドメニューを開くと、その後エディタ内で他の箇所にカーソルを移さない限り、他のGUI部品をクリックしたりしてもスラッシュコマンドメニューが最前面に表示され続ける。可能なら、エディタ以外の部分にフォーカスを移した時点でスラッシュコマンドメニューは非表示にしたい、、が、milkdownの仕様ならちょっと対応は要検討

## [ ] 3.テキスト直編集モードの追加
- 優先重み:1
- 記載日時:?

可能なら、wiswigモード以外に、生のマークダウンファイルを編集できるモードに切り替えられると嬉しい

## [x] 5. blob/chunk/block ベースの解析基盤を設計・実装したい
- 優先重み:9
- 記載日時:?

* すべての block を `id / plugin / block-type / params / inputs / outputs` の共通 schema に統一したい
* 元データ登録単位は `blob`、処理入出力単位は `chunk` に分けたい
* `1 input slot = 1 chunk`, `1 output slot = 1 chunk` を内部契約としたい
* GUI 上だけ `1 input slot = N blobs` を許し、app が source chunk を自動生成したい
* Python 解析は `general-analysis` plugin が `cwd/.py-scripts/` を走査して block-type を動的生成する形にしたい
* `.py-scripts/PYS-.../` には `script.json`, entry, 同梱ファイルを置き、`block-type` はその `PYS-...` にしたい
* Python block の `params` は MVP では `{}` 固定にし、`analysis-args.json` へ `inputs / outputs` の絶対パスだけを渡したい
* source chunk は `kind=source-bundle`、derived chunk は既定で `block-type.slotName` kind にしたい
* renderable な `html / image / text` は標準表示 block で描画し、可視化 plugin は renderable chunk を生成する処理 plugin とみなしたい
* 再実行時は新しい output chunk を生成し、未参照の古い chunk は GC できるようにしたい

## [x] 6. shimadzu-lc migration を進めたい
- 優先重み:6
- 記載日時:?

* `shimadzu-lc` の migration を進めたい
* `standard-graphs` は一旦削除してもよい

## [x] 7. エクスプローラー / ノート表示を chunk viewer 相当に広げたい
- 優先重み:5
- 記載日時:?

* エクスプローラーは `md` のみでフィルタせず、ワークスペース内の対象ファイルを全部表示したい
* 特にエクスプローラーの tree 構造側でも `.md` 限定フィルタが掛かっていそうなので外したい
* ノート部分のタブ表示でも `html / svg / image / text(json など)` を表示したい
* 要は `chunk viewer` と同等の表示系を main app 側にも導入したい

## [-] 8. markdown 以外の text 系ファイルも編集・保存したい
- Status:closed
- 優先重み:4
- 記載日時:2026-04-14-09:49(UTC+9)

* 2026-04-14 再検討の結果、`markdown` 以外は preview-only でよいことにした
* `markdown` は従来どおり Milkdown 編集を維持する
* `html / svg / image / text(json など) / binary` は preview / read-only 扱いとする

## [x] 9. 用語を `data-catalog / data-note / original data / dataset` ベースに大規模リネームしたい
- 優先重み:6
- 記載日時:2026-04-14-10:15(UTC+9)

* rename の基本方針は、`Artifacts -> data-catalog`, `artifact note -> data-note`, `blob -> original data`, `chunk -> dataset` としたい
* `blob -> dataset` は「単一 file / directory の import 単位」という現在の責務とズレるため避けたい
* `raw data` より `original data` の方が、加工済み CSV / text を持ち込む場合も含めて「workspace における元データ」という意味に寄せやすい
* `chunk` は source / derived の両方で「処理入出力としてのひとまとまりの data」を表すため、`dataset` の方が説明しやすい
* 文書修正対象として、少なくとも `docs/10_要求`, `docs/20_アーキテクチャ`, `docs/30_設計`, `docs/Issues.md` の用語を一貫して更新したい
* 特に `docs/20_アーキテクチャ/10_データモデル.md` と `docs/30_設計/20_ワークスペースレイアウト.md` は、概念定義と path 例が多いため優先的に直したい
* コード修正対象として、少なくとも `src/shared/integral.ts`, `src/main/integralWorkspaceService.ts`, `src/main/workspaceService.ts` の型名・定数名・API 名・metadata 名を更新したい
* renderer 側では `src/renderer/DataRegistrationDialog.tsx`, `src/renderer/IntegralAssetDialogs.tsx`, `src/renderer/PythonScriptDialog.tsx`, `src/renderer/integralCodeBlockFeature.tsx`, `src/renderer/App.tsx` の表示文言と state 名を更新したい
* workspace 配下の folder / path は、少なくとも `Artifacts/`, `.blob/`, `chunk/` と、その参照 path `artifactRelativePath`, `payloadRelativePath`, `links.json` 内の target を見直したい
* `source chunk / derived chunk / source-bundle` など、`dataset` 周辺の派生用語も合わせて再設計したい
* `BLB-...` / `CNK-...` などの ID prefix は rename 対象に含めるか別途維持するかを決めたい
* まずは `1. 文書 2. コード 3. フォルダ命名規則 4. UI` の順で進めたい
* 既存の開発用 workspace / note / link path も壊さないよう、必要なら migration を入れたい

## [ ] 10. data-note の metadata を frontmatter 化し、本文だけを表示したい
- 優先重み:5
- 記載日時:2026-04-14-10:17(UTC+9)

* data-catalog で現在 default 挿入している metadata 箇条書きは、本文ではなく frontmatter に持たせたい
* Milkdown は frontmatter を素直に扱えないため、`gray-matter` などで frontmatter と本文を分離し、本文だけを editor / viewer に渡す構成へ寄せたい
* 少なくとも当面は frontmatter を UI 上に表示・編集できなくてよい
* 将来的には frontmatter の内容を使って検索や絞り込みなどに活用できる形にしておきたい
* data-note の新規生成、保存、読込、表示の各経路で frontmatter を壊さず保持できるようにしたい
