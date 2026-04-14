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

## [ ] 11. Python script 実行 block の UI を簡素化したい
- 優先重み:5
- 記載日時:2026-04-14-10:49(UTC+9)

* Python script 実行 block では、slot ごとの dataset 割り当てと `block-type` が分かれば十分
* `plugin-name` の表示枠は不要
* `input` / `output` 数の表示枠は不要
* `input slots` / `output slots` の名称表示と、設定済み dataset 表示が分かれていて一覧性が悪い
* 各 slot は `slot名: 設定dataset名` の形で、一目で把握できる表示にしたい
* 全体的に余白が大きすぎるため、情報密度を上げたフラットな UI に寄せたい

## [ ] 12. Python script 系の input 割り当て導線を分かりやすくしたい
- 優先重み:5
- 記載日時:2026-04-14-10:53(UTC+9)

* 対象は `PythonScript` 登録 dialog と、登録済み script の実行 block の両方
* input に対する基本操作は、`既存 dataset を割り当てる` か `複数の original data から新しい dataset を作る` の 2 通りである
* 現状はこの基本導線が UI から読み取りにくく、何を選べばよいか分かりにくい
* まずは `dataset を選ぶ` のが基本であり、適した dataset が無ければ `original data から作る` こともできる、と伝わる UI にしたい
* 実装時に具体 UI を検討する前提で、今回の Issue では導線改善の必要性を先に整理しておきたい

## [ ] 13. source dataset の擬似リンク表現を `links.json` から見直したい
- 優先重み:5
- 記載日時:2026-04-14-11:00(UTC+9)

* 現状の source dataset は `links.json` ベースで original-data を参照しているが、ユーザーにとって直感的でなく、dataset フォルダを見たときの自然さにも欠ける
* 方針として、`links.json` や `.inlk` のような custom manifest をやめ、`.store` を canonical storage とする構成へ寄せたい
* `.store` のイメージは以下
  - `.store/.integral/{ID}.json` に metadata を置く
  - `.store/ORD_xxxxx{ext}` または `.store/ORD_xxxxx/` に original data の実体を置く
  - `.store/DS_xxxxx/` に dataset の実体を置く
  - システム内部の参照は path ではなく ID を正とする
* `cwd` 内でシステムが認識した file / directory は `.store` 側を canonical にし、ユーザーから見える側は alias として扱いたい
  - file は hard link
  - directory は junction
* source dataset でも、見た目は普通のファイル / フォルダ群にし、特殊な manifest を見せない構成にしたい
* `.integral` を無視すれば VS Code / Obsidian など外部ツールからも普通の filesystem として扱える構造に寄せたい
* 少なくとも以下を整理する必要がある
  - 同一 volume 制約
  - file は hard link、directory は junction で扱う前提
  - visible alias 側の rename / delete / edit をどう扱うか
  - source / derived dataset の provenance を metadata にどう持つか
  - name collision をどこで解消するか
* 進め方は以下の順にしたい
  - まず関連文書を精査し、`docs/10_要求`, `docs/20_アーキテクチャ`, `docs/30_設計` を現在方針へ完全更新する
  - 次に実装を更新する
  - 最後に、既存の未実装 Issue について、現在の設計に合わせて修正が必要なら見直す
