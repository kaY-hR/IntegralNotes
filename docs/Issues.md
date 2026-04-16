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

## [x] 3.テキスト直編集モードの追加
- Status:completed
- 優先重み:1
- 記載日時:?

可能なら、wiswigモード以外に、生のマークダウンファイルを編集できるモードに切り替えられると嬉しい
* 2026-04-14 調査: 実現性は高い。現在の `.md` 読込・保存は `src/main/workspaceService.ts` の `readNote() / saveNote()` に集約されており、主変更点は renderer 側の markdown tab に editor mode を足すことになる
* 現状の `src/renderer/App.tsx` は markdown tab の `content` / `savedContent` / dirty 判定 / `Ctrl+S` 保存を 1 本化しているため、`WYSIWYG` と `raw markdown` の 2 UI が同じ文字列 state を共有すれば、tab 管理や保存導線はほぼ再利用できる
* 実装方針としては、`OpenMarkdownTab` に `editorMode: "wysiwyg" | "text"` を持たせ、`editorFactory` で `MilkdownEditor` と軽量な plain text editor を切り替える構成が最もクリーン
* 注意点として、`src/renderer/MilkdownEditor.tsx` は mount 時の `initialValue` で初期化する非制御 component なので、`raw -> WYSIWYG` 切替時は mode を `key` に含めて再生成する設計にする必要がある
* Integral 独自 block は `itg-notes` fenced code block として markdown に保存されており、raw mode で直接編集しても保存経路自体は壊れない。内容が不正でも WYSIWYG 側では custom block view 内で parse error として扱えるため、設計上は許容しやすい
* 2026-04-14 再整理: Issue 20 により、frontmatter 隠蔽は `data-catalog/` 配下の data-note 限定ではなく、`cwd` 配下の Markdown 全体の標準動作になった
* そのため current 方針では、「生のマークダウン」を full file と解釈すると、data-note だけでなく任意 frontmatter を持つ通常 note とも衝突する
* clean に進めるなら、Issue 3 の `raw markdown` は `frontmatter を除いた本文 raw` と定義するのが最も自然
* この定義なら、`WYSIWYG` と `raw text` が同じ本文 string state を共有でき、frontmatter 保持・保存導線・tab 管理をそのまま再利用しやすい
* 一方で full-file raw 編集まで求めると、frontmatter 表示 UX、保存契約、rename / move 時の本文-only rewrite、managed data-note metadata 保護をまとめて再設計する必要があり、Issue 3 単体としては重い
* 結論として、current Issue 3 は `Markdown tab 向けの body-only source editing mode` として切るのが妥当で、frontmatter を含む完全な生ファイル編集は別 Issue に分離した方がよい
* 2026-04-15 実装:
  - `src/renderer/App.tsx` の markdown tab state に `editorMode` を追加し、tab 内右上 button から `WYSIWYG` と `body-only text` を切り替えられるようにした
  - `src/renderer/RawMarkdownEditor.tsx` を追加し、frontmatter を見せずに本文だけを monospaced textarea で編集できるようにした
  - `src/renderer/MilkdownEditor.tsx` に共通 toolbar slot を追加し、mode 切替 UI を WYSIWYG 側と text 側で同じ位置に揃えた
  - `Ctrl+S` 保存、dirty 判定、frontmatter 保持、Markdown link / image rewrite は既存の本文 string 契約をそのまま再利用している

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

## [x] 10. data-note の metadata を frontmatter 化し、本文だけを表示したい
- Status:completed
- 優先重み:5
- 記載日時:2026-04-14-10:17(UTC+9)

* data-catalog で現在 default 挿入している metadata 箇条書きは、本文ではなく frontmatter に持たせたい
* Milkdown は frontmatter を素直に扱えないため、`gray-matter` などで frontmatter と本文を分離し、本文だけを editor / viewer に渡す構成へ寄せたい
* 少なくとも当面は frontmatter を UI 上に表示・編集できなくてよい
* 将来的には frontmatter の内容を使って検索や絞り込みなどに活用できる形にしておきたい
* data-note の新規生成、保存、読込、表示の各経路で frontmatter を壊さず保持できるようにしたい

## [x] 11. Python script 実行 block の UI を簡素化したい
- Status:completed
- 優先重み:5
- 記載日時:2026-04-14-10:49(UTC+9)

* Python script 実行 block では、slot ごとの dataset 割り当てと `block-type` が分かれば十分
* `plugin-name` の表示枠は不要
* `input` / `output` 数の表示枠は不要
* `input slots` / `output slots` の設定済み datasetは不要。登録時に必要なのはslot名のみ
* 全体的に余白が大きすぎるため、情報密度を上げたフラットな UI に寄せたい
* 登録後、自動的に作成したblockを挿入してほしい。

## [x] 12. Python script 系の input 割り当て導線を分かりやすくしたい
- Status:completed
- 優先重み:5
- 記載日時:2026-04-14-10:53(UTC+9)

* 対象は `PythonScript` 登録 dialog と、登録済み script の実行 block の両方
* input に対する基本操作は、`既存 dataset を割り当てる` か `複数の original data から新しい dataset を作る` の 2 通りである
* 現状はこの基本導線が UI から読み取りにくく、何を選べばよいか分かりにくい
* まずは `dataset を選ぶ` のが基本であり、適した dataset が無ければ `original data から作る` こともできる、と伝わる UI にしたい
* dataset割り当て後、idが見えているが、名称を出すようにしてほしい
* 実装時に具体 UI を検討する前提で、今回の Issue では導線改善の必要性を先に整理しておきたい

## [x] 13. source dataset の擬似リンク表現を `links.json` から見直したい
- Status:completed
- 優先重み:5
- 記載日時:2026-04-14-11:00(UTC+9)

* 現状の source dataset は `links.json` ベースで original-data を参照しているが、ユーザーにとって直感的でなく、dataset フォルダを見たときの自然さにも欠ける
* 方針として、`links.json` や `.inlk` のような custom manifest をやめ、`.store` を canonical storage とする構成へ寄せたい
* `.store` のイメージは以下
  - `.store/.integral/{ID}.json` に metadata を置く
  - `.store/{originalDataId}{ext}` または `.store/{originalDataId}/` に original data の実体を置く
  - `.store/{datasetId}/` に dataset の実体を置く
  - システム内部の参照は path ではなく ID を正とする
* original data の能動登録は `cwd` 内外の両方を扱いたい
  - `cwd` 外から登録した場合は `.store` に canonical 実体をコピーし、`Data/` に alias を置く
  - すでに `cwd` 内にある対象を登録した場合は `.store` 側を canonical にし、元の path を alias として残す
* システムが認識した file / directory は `.store` 側を canonical にし、ユーザーから見える側は alias として扱いたい
  - file は hard link
  - directory は junction
* source dataset でも、見た目は普通のファイル / フォルダ群にし、特殊な manifest を見せない構成にしたい
* `.integral` を無視すれば VS Code / Obsidian など外部ツールからも普通の filesystem として扱える構造に寄せたい
* 未リリース前提なので後方互換コードは持たず、旧レイアウト / 旧 block type の救済は残さない
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

## [x] 14. dataset / original data の ID prefix を `DTS-` / `ORD-` に変更したい
- Status:completed
- 優先重み:4
- 記載日時:2026-04-14-13:39(UTC+9)

* 現状の `CNK-...` / `BLB-...` は旧用語由来で、現在の `dataset` / `original data` 命名と揃っていない
* `CNK-...` は `DTS-...`、`BLB-...` は `ORD-...` へ寄せたい
* 少なくとも `docs/10_要求`, `docs/20_アーキテクチャ`, `docs/30_設計`, `docs/Issues.md`, `src/` 配下の表示文言・型名・metadata 例を見直したい
* `.store/.integral/*.json`, data-note frontmatter / 本文, `Data/` alias 名, `.py-scripts` や block JSON との参照整合も確認したい
* 未リリース前提で migration は追加せず、新規生成 ID を `DTS-...` / `ORD-...` に切り替える方針とした

## [x] 15. dataset 作成時も data-catalog に data-note を生成したい
- Status:completed
- 優先重み:4
- 記載日時:2026-04-14-13:39(UTC+9)

* 現状は original data の data-note は自動生成しているが、dataset には対応する data-note が自動生成されていない
* source dataset / derived dataset のどちらでも、生成時に `data-catalog/` へ対応する data-note を作りたい
* data-note には dataset ID, kind, createdAt, createdByBlockId, sourceMembers など、検索や参照に使いたい metadata を frontmatter で保持したい
* block 実行結果から dataset をたどるだけでなく、catalog 側から dataset を見つけてノートへ参照しやすい導線にしたい
* dataset 再生成時の重複生成や更新方針、GC 時に data-note をどう扱うかも整理したい

## [x] 16. トップバー「データ登録」メニューからの dialog の UI を改善したい
- Status:completed
- 優先重み:5
- 記載日時:2026-04-14(UTC+9)

* Issue 11, 12 と同様の方針で、`DataRegistrationDialog` の UI を見直したい
* 現状は情報密度が低く、導線が分かりにくい
* 余白の縮小、操作の優先度の明確化、表示の簡素化を行いたい

## [x] 17. Python script block / dialog 周りの UI を目的起点で再設計したい
- Status:completed
- 優先重み:6
- 記載日時:2026-04-14-15:50(UTC+9)

* 対象は `PythonScript` 実行 block、dataset 選択 dialog、dataset 作成 dialog を中心とした block / dialog 周り
* 現状は system 用語の `source dataset` や `元データ` がそのまま前面に出ており、ユーザーが画面の目的を理解しづらい
* user-facing 文言は `source dataset` ではなく `dataset`、`元データ` ではなく `データファイル` を基本に統一したい
* その画面に来るユーザーの主目的は「この input slot に使うデータを決めて先へ進むこと」であり、最初に見る情報と primary action はその目的に揃えるべき
* script 実行 block では、slot ごとの主要操作を `データを割り当て` の 1 つへ寄せたい
* 現状の `データセットを割り当て` と `元データからデータセットを作成` は見た目だけ並列で、操作の優先度と関係が伝わりにくい
* 基本導線は「まず既存 dataset を選ぶ」、適切な dataset が無いときの代替導線として「データファイルから新しい dataset を作る」を同一フロー内で案内したい
* dataset 選択 dialog から、そのまま `データファイル` を選んで dataset を新規作成できる導線を案内したい
* dataset 作成 dialog では `ファイルを追加` と `フォルダを追加` は並列の選択肢として同じ hierarchy と揃った配置で表現したい
* 並列な選択肢を出す場面では、ラベル、説明量、button 配置、整列を揃え、UI 上でも「同格の選択肢」であることが伝わるようにしたい
* 逆に primary / secondary の関係がある操作は、見た目だけ並列にせず、1st action と補助導線の差が明確に分かる構成へ寄せたい
* Issue 11, 12 の簡素化・導線改善を、用語整理と情報設計まで含めて再定義する Issue として扱いたい

## [x] 18. エクスプローラーの tree 操作を VS Code 寄りに強化したい
- Status:completed
- 優先重み:7
- 記載日時:2026-04-14-16:10(UTC+9)

* treeview で複数選択を許容したい
* `Ctrl` + drag で copy、通常 drag-drop で move をできるようにしたい
* 外部 OS から explorer への drop でも copy として取り込みたい
* クリップボードからの画像貼り付けを許容し、名前は `image.png` 固定、保存先は選択中 item 基準にしたい
* 右クリックメニューから `コピー / 貼り付け / 削除 / 名前を変更 / パスのコピー / 相対パスのコピー / DataSetに追加` を実行したい
* `コピー / 貼り付け / 削除 / 名前を変更` は既存機能がある前提で、コンテキストメニューからも同じ操作を呼べるようにしたい
* note editor 内の画像挿入 / 画像貼り付けの永続化は `Issue 23` で別に扱う
* `DataSetに追加` は複数ファイル選択を許容し、必要に応じて original data 登録を経由して source dataset 作成へ繋げたい

## [x] 19. 表示不可ファイルのタブから外部アプリで開けるようにしたい
- Status:completed
- 優先重み:4
- 記載日時:2026-04-14-16:10(UTC+9)

* main app 上で表示できないファイルを開いている場合、タブ内に `[外部アプリで開く]` button を出したい
* クリック時はその拡張子に紐づいた既定アプリで file を開きたい
* エクスプローラーで表示非対応ファイルをダブルクリックした場合も、タブで開く代わりに OS 既定プログラムで直接開きたい
* 実装は main process 経由で `Process.Start` 相当の OS 既定動作に寄せたい

## [x] 20. frontmatter 分離を `data-catalog` 限定ではなく cwd 全体の標準動作にしたい
- Status:completed
- 優先重み:5
- 記載日時:2026-04-14-17:04(UTC+9)

* 現状の frontmatter 分離は、少なくとも `workspaceService.ts` 上は `data-catalog` 配下の note だけに限定されていそう
* `gray-matter` もしくは同等の安定した frontmatter parser を使い、`cwd` 配下の Markdown 全体で frontmatter と本文を標準的に分離したい
* 読み込み時は frontmatter を保持したまま、editor / viewer には本文だけを渡したい
* 保存時は本文だけを更新し、既存 frontmatter は壊さず保持したい
* `data-catalog` 専用実装ではなく、通常 note でも frontmatter を自然に使えることを目標にしたい
* `data-note` 専用 metadata の扱いと、一般 Markdown の任意 frontmatter の扱いをどう両立するか整理したい
* 2026-04-14 実装:
  - `src/main/frontmatter.ts` に generic frontmatter utility を追加し、`---` / `...` fence を使う Markdown frontmatter を main process 側で標準的に扱うようにした
  - `src/main/workspaceService.ts` の `.md` read / save を `data-catalog` 条件から外し、`cwd` 配下 Markdown 全体で `frontmatter は保持 / editor・viewer へは本文だけ` に統一した
  - rename / move 時の Markdown link / image target rewrite は本文だけへ適用し、frontmatter 内の任意 metadata は保持するようにした
  - `src/main/dataNote.ts` も同じ utility を使うように整理し、`data-note` managed metadata と一般 Markdown frontmatter が同じ基盤上で共存する構成にした

## [x] 21. dataset の data-note 本文に canonical data へのリンクを入れたい
- Status:completed
- 優先重み:4
- 記載日時:2026-04-14-17:07(UTC+9)

* dataset の data-note を自動生成するとき、本文に dataset 実体へのリンクを入れたい
* human-friendly な label と canonical path を両方持てるリンク表現にしたい
* 少なくとも source dataset / derived dataset の両方で一貫した本文テンプレートにしたい
* frontmatter だけでなく本文からも実体へ辿れるようにして、catalog note を起点に dataset を開きやすくしたい
* 候補は `標準 Markdown link`, `wiki link`, `app 専用 action` なので、どれを canonical にするかを整理したい
* `通常 note -> workspace file` の link 仕様は `docs/30_設計/60_ノートリンク記法.md` で分離したため、本 Issue では `data-note -> canonical data` に限定して考える
* 2026-04-14 実装:
  - dataset data-note 本文の既定テンプレートを title-only から、canonical dataset 配下の各 file への箇条書き link 付きへ更新した
  - 既存の自動生成 data-note も、本文が未編集なら現在の file 一覧に合わせて再生成されるようにした
  - source dataset だけでなく、Python 実行で生成される derived dataset も実行後に再 sync して file link 一覧が更新されるようにした
  - `docs/10_要求/10_MVP要件.md`, `docs/20_アーキテクチャ/10_データモデル.md`, `docs/30_設計/20_ワークスペースレイアウト.md`, `docs/30_設計/60_ノートリンク記法.md` を現在仕様に更新した

## [x] 22. Milkdown で workspace file への Markdown link 補完と open を実装したい
- Status:completed
- 優先重み:4
- 記載日時:2026-04-14-17:12(UTC+9)

* 詳細仕様は `docs/30_設計/60_ノートリンク記法.md` を参照
* link 記法は Obsidian 風 wiki link ではなく、標準 Markdown link `[label](target)` を使う
* app が補完で自動挿入する canonical form は `[label](/path/from/cwd)` とする
* app は `/path/from/cwd` と `path/from/cwd` の両方を workspace root 基準で解決する
* Milkdown では `[` 入力時に `cwd` 配下 file 候補を表示し、選択時に `[label](/path)` を挿入したい
* 候補は `cwd` 配下の全 file を対象とし、file 名を主表示、path を補足表示としたい
* label は
  - `.md` では拡張子なし
  - 非 `.md` では拡張子あり
  としたい
* link click 時は既存 workspace file open 経路に寄せたい
  - `.md` は app 内 tab
  - renderable / text は app 内 viewer
  - unsupported は外部アプリ
* IntegralNotes 内の rename / move では、`cwd` 配下 `.md` を走査して link target を自動更新したい
* heading link 補完、`data-note -> canonical data` link、外部変更追従は本 Issue の対象外とする
* 2026-04-14 実装:
  - Milkdown editor 上で `[` 入力時に workspace file 候補 popup を表示し、選択時に `[label](/path)` を挿入するようにした
  - `/path` と `path` の両方を resolver で扱い、click 時は `.md / renderable / text / unsupported` を既存 open 導線へ流すようにした
  - rename / move 時は main process で `cwd` 配下 `.md` の Markdown link / image target を更新し、open tab 側も同じ rewrite を適用するようにした

## [x] 23. Milkdown の画像挿入 / 画像貼り付けで blob URL ではなく workspace 永続画像を保存したい
- Status:completed
- 優先重み:6
- 記載日時:2026-04-14-17:38(UTC+9)

* 詳細仕様は `docs/30_設計/70_ノート画像添付.md` を参照
* note 本文の画像は標準 Markdown image 記法 `![alt](target)` を使う
* app が自動挿入する canonical form は `![](/Data/yyyyMMdd-HHmm-RRR.ext)` としたい
* 画像 file の保存先は `Data/` 配下固定とし、file 名は `時刻 + 3 桁 random + 拡張子` で決めたい
* saved markdown に `blob:` URL や一時 object URL を残さないようにしたい
* Milkdown の image insert UI と clipboard paste / drop は、可能なら共通 upload hook で同じ永続化 policy を適用したい
* editor 再表示時は、workspace path を DOM 用 URL へ変換して、app 再起動後も画像が表示されるようにしたい
* 読み取り時は `/path/from/cwd` と `path/from/cwd` の両方を workspace root 基準で解決したい
* 自動保存先は `Data/` だが、手書き image link は workspace 内の他 path も許容したい
* IntegralNotes 内の rename / move では、`cwd` 配下 `.md` を走査して image target も自動更新したい
* explorer 上の画像貼り付け、保存先設定 UI、非 image attachment、外部 URL の自動取込は本 Issue の対象外とする
* 2026-04-14 実装:
  - `src/main/workspaceService.ts` に note image 保存 API を追加し、`Data/yyyyMMdd-HHmm-RRR.ext` 形式で永続化して canonical target `![](/Data/...)` を返すようにした
  - `src/main/main.ts`, `src/main/preload.ts`, `src/shared/workspace.ts` に IPC / 型を追加し、renderer から file bytes を送って保存できるようにした
  - `src/renderer/MilkdownEditor.tsx` の `Crepe.Feature.ImageBlock` に `onUpload` と `proxyDomURL` を設定し、image insert / paste / drop が同じ永続化 policy を通るようにした
  - editor 再表示時は workspace path を main process 経由で DOM 用の loadable URL に変換し、再起動後も画像を表示できるようにした
  - `src/renderer/App.tsx` で画像保存後の workspace snapshot を反映し、`Data/` 配下の新規 file が explorer に現れるようにした
* 2026-04-15 修正:
  - Electron renderer で `file://` が `Not allowed to load local resource` になるケースがあったため、`resolveWorkspaceFileUrl()` は `file:` URL ではなく `data:` URL を返すように変更した

## [ ] 24. managed data を `id / path / hash` 基盤へ再設計し、data-note を system-managed 化したい
- Status:in-progress
- 優先重み:9
- 記載日時:2026-04-15-12:20(UTC+9)

* 現状は `data-catalog/` 配下の visible Markdown file を data-note として扱い、original data / dataset の canonical link を本文に自動生成しているが、このモデルはユーザーにとって path / file 名の管理責務が重すぎる
* 新方針では、original data / dataset を共通の managed data とみなし、少なくとも `id`, `path`, `hash` を持つ
* `path` は workspace relative path とし、visible / hidden のどちらでもよい。`.store` は hidden path の default に過ぎない
* `Data/` は visible data や画像保存先の default location に過ぎず、canonical な特別フォルダではない
* tracking の基盤は `source / derived`, `original data / dataset` を問わず共通にし、`path same + hash same`, `path changed + hash same`, `path same + hash changed`, `path changed + hash changed` を扱えるようにしたい
* dataset は `directory` だけでなく `dataset-json` representation も扱いたい。少なくとも source dataset は `originalDataId[]` を持つ custom manifest で表せるようにしたい
* block schema 上の `inputs / outputs` は従来どおり `datasetId | null` とし、実行時に app が `datasetId -> readable directory path` を resolve する層を入れたい
* data-note は `1 managed data = 1 data-note` とし、ID に 1:1 で紐づけて `.store/.integral/data-notes/{id}.md` に保存したい
* data-note は system-managed note とし、ユーザーは本文だけを編集する。rename / move は許可しない
* data-note は canonical file link 集ではなく、「この data は何か」を記述するノートとして扱いたい
* これにより、data-note は「データファイル / データセットという概念にぶら下がる説明ノート」として扱い、workspace 上の file path と切り離したい

* まず修正すべき文書:
  - `docs/10_要求/00_プロダクト概要.md`
  - `docs/10_要求/10_MVP要件.md`
  - `docs/10_要求/20_ユーザー体験.md`
  - `docs/20_アーキテクチャ/00_全体アーキテクチャ.md`
  - `docs/20_アーキテクチャ/10_データモデル.md`
  - `docs/20_アーキテクチャ/30_Python汎用解析プラグイン.md`
  - `docs/30_設計/10_ブロックJSON設計.md`
  - `docs/30_設計/20_ワークスペースレイアウト.md`
  - `docs/30_設計/30_Pythonスクリプト登録と実行.md`
  - `docs/30_設計/40_標準描画と結果閲覧.md`
  - `docs/30_設計/60_ノートリンク記法.md`

* 実装修正の主対象:
  - `src/main/dataNote.ts`
    - data-note を frontmatter/path ベースではなく ID 直結の system-managed note として再設計する
    - 自動生成本文から canonical file link 一覧前提を外す
  - `src/main/workspaceService.ts`
    - `data-catalog/` 同期を廃止し、`.store/.integral/data-notes/` 同期へ置き換える
    - data-note を explorer 上の user-managed file として扱わない前提に寄せる
  - `src/main/integralWorkspaceService.ts`
    - original data / dataset metadata を `id / path / hash` ベースへ広げる
    - `storeRelativePath / aliasRelativePath` 前提を見直す
    - data-note path 解決を `data-catalog` 依存から ID 固定 path へ変更する
    - dataset 実行時の path 解決を `datasetId -> readable directory path` 層に寄せる
  - `src/shared/integral.ts`
    - summary / inspection 系の型を新 metadata に合わせて更新する
  - `src/renderer/App.tsx` と関連 dialog
    - data-note open 導線を file path ではなく data entity 起点で扱う
    - user-facing 文言から file 名管理前提を外す

* 実装順序の推奨:
  1. data-note を `.store/.integral/data-notes/{id}.md` へ移し、system-managed 化する
  2. metadata schema を `id / path / hash` ベースへ拡張する
  3. original data / dataset の current path 解決を `storeRelativePath` 固定から切り離す
  4. source dataset の `dataset-json` representation と実行時 resolve 層を入れる
  5. renderer 側の data-note 導線と表示文言を揃える

* 補足:
  - Issue 15, 21 の「visible data-note file / canonical link 本文」前提は、この Issue の設計で再定義される
  - 未リリース前提のため、必要なら旧 `data-catalog/` layout との互換は持たなくてよい
* 2026-04-15 実装第1段:
  - `docs/10_要求`, `docs/20_アーキテクチャ`, `docs/30_設計` の主要文書を `id / path / hash` 基盤 + system-managed data-note 方針へ更新した
  - `src/main/workspaceService.ts` を更新し、data-note の同期先を `data-catalog/` から `.store/.integral/data-notes/{id}.md` に変更した
  - `src/main/integralWorkspaceService.ts` を更新し、data-note path を file 名解決ではなく ID 固定 path で返すようにした
  - `src/main/dataNote.ts` を更新し、data-note 既定本文から canonical file link 一覧前提を外し、説明 note 寄りにした
  - `npm run build` が通ることを確認した
* 2026-04-15 実装第2段:
  - `src/shared/integral.ts` を更新し、original data / dataset summary に `path`, `hash`, `representation`, `visibility`, `provenance` を追加した
  - `src/main/integralWorkspaceService.ts` を更新し、metadata schema を `id / path / hash` ベースへ拡張した
  - original data は visible current path と hidden object path を分けて保持しつつ、summary / tracking 上は `path` を主として扱うようにした
  - source dataset の既定表現を visible `dataset-json` manifest (`datasets/*.idts`) に変更し、`memberIds` を保持するようにした
  - `datasetId -> readable directory path` の resolve 層を導入し、`dataset-json` は staging directory へ materialize して inspect / execute / display できるようにした
  - 起動時・利用時に metadata を再読込し、`path same + hash changed` と `path changed + hash same` を中心に再同期する reconciliation を追加した
  - `src/main/dataNote.ts` と `src/main/workspaceService.ts` を更新し、新 metadata schema と旧 metadata の両方から hidden data-note を再生成できるようにした
  - `src/renderer/IntegralAssetDialogs.tsx` などを更新し、picker 上の表示を `displayName / representation / visibility` ベースに寄せた
  - `npm run build` が通ることを確認した
* 2026-04-15 実装第3段:
  - `src/renderer/workspaceOpenEvents.ts` を追加し、renderer 内の任意 UI から `workspace file open` を要求できる event を共通化した
  - `src/renderer/App.tsx` を更新し、hidden data-note tab を workspace snapshot 更新で自動 close しないようにした
  - 併せて、hidden data-note を開いたときは explorer selection を無理に同期しないようにし、tree に存在しない system-managed note を自然に扱えるようにした
  - `src/renderer/IntegralAssetDialogs.tsx` を更新し、dataset / original data picker から各 managed data の `data-note` を直接開けるようにした
  - `src/renderer/integralCodeBlockFeature.tsx` を更新し、display block と input / output slot 行から、割り当て済み dataset の `data-note` を開けるようにした
  - `src/renderer/styles.css` を更新し、上記 note 導線に合わせて picker row と block toolbar の layout を調整した
  - `npm run build` が通ることを確認した
* 2026-04-15 実装第4段:
  - 別スレッド由来で混ざっていた renderer 実装を点検し、data-note open 導線が hidden file path 直指定になっていた箇所を修正した
  - `src/renderer/IntegralAssetDialogs.tsx` と `src/renderer/integralCodeBlockFeature.tsx` は、hidden note path を直接持たず `targetId` から open 要求する形へ揃えた
  - `src/renderer/App.tsx` で `targetId -> .store/.integral/data-notes/{id}.md` の解決を一元化し、system-managed note の hidden path 知識を UI component から外した
  - `src/shared/integral.ts` と `src/main/integralWorkspaceService.ts` から `dataNoteRelativePath` を外し、shared / renderer 契約を ID 基点へ寄せた
  - `src/main/preload.ts`, `src/main/main.ts`, `src/shared/workspace.ts`, `src/main/integralWorkspaceService.ts`, `src/renderer/App.tsx` を更新し、`path changed + hash changed` で候補が複数ある場合の confirm 導線を追加した
  - confirm は current 実装では `basename` ベースの candidate 検出を使い、候補が一意なら自動追従し、複数なら dialog で選ばせる
  - `src/renderer/ManagedDataTrackingDialog.tsx` を追加し、recorded path / hash と候補 path 一覧を見ながら tracked path を更新できるようにした
  - `npm run build` が通ることを確認した
* 2026-04-15 実装第5段:
  - original data import に残っていた `.store/objects` canonical storage 前提を外した
  - `cwd` 外から登録した original data は visible な `Data/` 配下へ copy し、`cwd` 内の対象はその場の path をそのまま managed `path` として採用するようにした
  - `src/main/integralWorkspaceService.ts` の `resolveOriginalDataContentPath()` を visible `metadata.path` 基点へ変更し、source dataset materialize も hidden object ではなく current visible path を参照するようにした
  - new metadata では `objectPath` を書かず、旧 metadata の hidden canonical 参照は reconciliation / update 時に段階的に消える形へ寄せた
  - `docs/10_要求/10_MVP要件.md` と `docs/20_アーキテクチャ/10_データモデル.md` を更新し、original data の canonical 実体を `.store/objects` に置かない方針へ合わせた
  - `npm run build` が通ることを確認した
* 2026-04-15 実装第6段:
  - `src/main/workspaceService.ts` に workspace mutation listener を追加し、create / delete / modify / move を root 側で一元的に通知できるようにした
  - `src/main/main.ts` で `IntegralWorkspaceService` をその listener に接続し、explorer 上の rename / move / delete / save 後に managed-data metadata の reconcile を即時走らせるようにした
  - `src/main/integralWorkspaceService.ts` に `handleWorkspaceMutations()` を追加し、変更 path が tracked `id / path / hash` metadata に関係する場合のみ reconcile するようにした
  - これにより、ソフト内 rename / move で `json` が追随しない問題を、個別操作パスの継ぎ足しではなく `WorkspaceService` の変異イベント起点で吸収する構成へ寄せた
  - 併せて `src/main/workspaceService.ts` の bulk delete mutation 収集を修正し、途中で壊れていた `deleteEntries()` を正常化した
  - `workspace:renameEntry` で非 `.md` file rename が落ちない修正もこの流れで維持し、`npm run build` が通ることを確認した
* 2026-04-15 実装第7段:
  - `src/renderer/App.tsx` に managed data catalog を保持する state と `relativePath -> managed data` 解決を追加し、現在開いている file / path が original data または dataset に属するかを renderer 側で判定できるようにした
  - 同じ解決層を使って `targetId -> data-note` open 時の tab 名を friendly name (`<displayName> のノート`) に寄せ、hidden file 名が前面に出ないようにした
  - `src/renderer/WorkspaceFileViewer.tsx` と `src/renderer/styles.css` を更新し、renderable / text / unsupported file を見ているとき、対応する managed data があれば右上または action row から `[ノートを開く]` を押せるようにした
  - `src/renderer/App.tsx` の markdown tab toolbar にも同じ note open action を足し、managed data が Markdown file の場合でも別タブで note を開けるようにした
  - `npm run build` が通ることを確認した

## [x] 25. managed data を見ている文脈から data-note を別タブで開けるようにしたい
- Status:in-progress
- 優先重み:7
- 記載日時:2026-04-15-21:31(UTC+9)

* `data-note` は system-managed note になったが、現状は「ある original data / dataset を見ているときに、その data の note を当然のように開ける」導線がまだ弱い
* UX としては、tab 内分割や hidden folder 表示ではなく、VS Code の preview に近い感覚で「今見ている managed data に対応する note を別タブで開く」形に寄せたい
* managed data を app 内で開いたときは、右上に `[ノートを開く]` または `[<displayName> のノートを開く]` 相当の action を出したい
* その action は hidden path を UI component が直接知るのではなく、managed data の `targetId` から対応する `data-note` tab を開く経路にしたい
* 対象は original data / dataset の両方とし、renderable / text / unsupported のどの viewer 文脈でも一貫して note を開けるようにしたい
* renderable file は従来どおり preview を主とし、note は別タブで開く
* 表示不可 file は従来どおり `[外部アプリで開く]` を維持しつつ、同じ画面から note も開けるようにしたい
* すでに対象 `data-note` tab が開いている場合は、新規 tab を増やすのではなく既存 tab を選択する挙動にしたい
* user-facing な tab 名や action 文言は hidden file 名 (`ORD-...md`, `DTS-...md`) ではなく、managed data の `displayName` / `name` を優先したい
* 実装上は `relativePath -> managed data entity` を解決できる層を renderer / main のどちらかに持ち、通常 file open と managed-data open を分岐できるようにしたい
* Issue 24 の `data-note を entity 起点で扱う` 方針の延長だが、こちらは基盤よりも viewer / tab UX の明確化を主対象とする
* 2026-04-15 実装:
  - `src/renderer/App.tsx` で asset catalog を保持し、開いている `relativePath` が managed data の current path または directory 配下 path に一致する場合、対応する target を引けるようにした
  - `src/renderer/WorkspaceFileViewer.tsx` に note open action を追加し、renderable / text は右上、unsupported は action row から `[ノートを開く]` を押せるようにした
  - `src/renderer/App.tsx` の markdown toolbar にも同じ action を出し、managed data が Markdown file の場合でも note を別タブで開けるようにした
  - `OPEN_MANAGED_DATA_NOTE_EVENT` 経由の open では tab 名を `<displayName> のノート` へ寄せ、既存 tab があればその tab を再利用する挙動を維持した
  - `npm run build` が通ることを確認した

## [x] 26. Milkdown で `![` から workspace file の埋め込み挿入と preview をしたい
- Status:completed
- 優先重み:6
- 記載日時:2026-04-15-23:12(UTC+9)

* 現状は `[` で workspace file への Markdown link 補完はできるが、`![` で埋め込みリンクを選んで貼る導線はまだない
* 画像だけでなく、workspace 内 file を note 本文へ「参照リンク」ではなく「埋め込み preview」として貼りたい
* 補完 trigger は `![` とし、候補一覧・path 解決規則は通常 link と同じく `cwd` 配下 file を対象にしたい
* 挿入時の canonical form は Markdown image 記法ベースの `![](/path/from/cwd)` としたい
* 埋め込み preview の表示方針は少なくとも以下を満たしたい
  - `png / jpg / jpeg / gif / webp / bmp` は画像として表示
  - `html` は iframe 的に表示
  - `svg` は image 扱いではなく iframe 的に表示
  - `md / txt / json / csv` など text 系は iframe 的な read-only preview で表示
  - app 内表示非対応 file は、対応する managed data が引けるなら `data-note` を iframe 的に表示する
* unsupported file が managed data に対応しない場合は、少なくとも無言で壊れず「未対応」であることを示したい
* 既存の note 画像 upload / paste / drop (`Issue 23`) や rename / move rewrite は、そのまま再利用できる構成に寄せたい
* 2026-04-15 実装:
  - `src/renderer/MilkdownEditor.tsx` を更新し、補完 state を `link / embed` の 2 種に拡張した
  - `![` 入力時も `[` と同じ workspace file 候補 popup を出し、選択時は `![](/path/from/cwd)` を Markdown image 記法として挿入するようにした
  - `src/renderer/workspaceEmbedFeature.tsx` を追加し、Milkdown の `image` / `image-block` node view を workspace embed 向けに差し替えた
  - 埋め込み preview は `html / svg / text / markdown / image` を editor 内で read-only preview できるようにし、`html / svg / text / markdown` は iframe 系表示へ寄せた
  - app 内 preview 非対応 file は managed data に対応づく場合、`.store/.integral/data-notes/{id}.md` を読んで `DATA-NOTE` preview として表示するようにした
  - embed node の空状態でも、workspace path 手入力と既存 image upload hook 経由の画像選択を続けられるようにした
  - `src/renderer/styles.css` に embed card / iframe / empty state の style を追加した
  - `npm run build` が通ることを確認した
* 2026-04-16 修正:
  - 補完候補を mouse で選んだとき、誤って link 挿入経路へ流れていた不具合を修正した
  - embed 挿入は Markdown 文字列の流し込みではなく、Milkdown の `image` node を直接挿入するように変更した
  - これにより source は通常の `![](/path)` になり、preview 側も inline image node view から workspace embed renderer へ確実に流れるようにした
  - `![` に加えて `!` 単体でも補完 popup を開けるようにした
  - `npm run build` が通ることを確認した
* 2026-04-16 仕上げ:
  - embed card から file 名 / 拡張子 badge 表示を外し、padding と border radius を少し詰めて preview 優先の見た目に寄せた
  - `.md` の embed preview は plain text iframe ではなく readonly の Milkdown / Crepe で描画し、list・heading などを rich に見られるようにした
  - app 内 preview 非対応 file の managed `data-note` fallback も同じ markdown preview に寄せた
  - embed block 全体の click で、workspace file は通常 tab、managed `data-note` fallback は note tab を開けるようにした
  - `npm run build` が通ることを確認した
* 2026-04-16 レイアウト調整:
  - embed は基本的に横幅いっぱいを使う方針に寄せ、従来の inline 幅制限を外した
  - embed surface に縦方向の drag resize handle を追加し、画像 / iframe / markdown preview を高さだけ変えられるようにした
  - click-to-open はそのまま維持しつつ、preview 本体は pointer event を持たず、surface click で tab open する構成に整理した
  - なお高さは現状 editor session 内の UI state であり、Markdown source への永続化はまだしていない
  - `npm run build` が通ることを確認した
* 2026-04-16 永続化と画像拡大抑止:
  - embed 高さは target suffix の `#integral-embed-height=NNN` として保持し、再オープン後も同じ高さで復元できるようにした
  - `src/shared/workspaceLinks.ts` でこの suffix を path 解決時に無視しつつ、rename / move rewrite 時には保持するようにした
  - 画像 embed は `object-fit: scale-down` に変更し、枠が大きくても元画像以上には拡大表示しないようにした
  - default 高さに戻した場合は suffix を落とし、必要なときだけ source に metadata が残るようにした
  - `npm run build` が通ることを確認した
* 2026-04-16 画像は Milkdown 標準へ戻す:
  - `src/renderer/workspaceEmbedFeature.tsx` の image / image-block node view を bridge 化し、workspace の非画像 path だけ custom embed renderer を使うようにした
  - `png / jpg / jpeg / gif / webp / bmp / avif` など通常画像は、workspace path でも外部 URL でも Milkdown 標準の image view に委譲するようにした
  - これにより画像だけは custom の full-width / click-open / resize surface ではなく、Milkdown 既定の選択・編集 UI を使えるようにした
  - 以前の custom image resize で残っていた `#integral-embed-height=NNN` は、標準画像 view に入るノードでは自動で落とすようにした
  - `npm run build` が通ることを確認した

## [x] 27. 拡張子ごとに専用 viewer を plugin できる統合 plugin system を追加したい
- Status:completed
- 優先重み:6
- 記載日時:2026-04-16-08:42(UTC+9)

* plugin system 自体は分けず、既存の plugin package / install / manifest / registry に viewer contribution を追加したい
* 設計方針は「plugin system は統合、contribution type は分離」とし、同一 plugin が `blocks` と `viewers` の両方を持てるようにしたい
* first version の viewer matcher は extension-only に限定し、`extensions: [".foo", ".bar"]` で専用 viewer を解決したい
* 既存 plugin への影響は additive に抑え、`viewers` を持たない既存 plugin はそのまま読めるようにしたい
* viewer 解決順は `plugin viewer -> built-in viewer -> unsupported / 外部アプリ` にしたい
* 対象は少なくとも workspace file viewer と dataset の標準表示 block の両方にしたい
* `.md` の note editor / note tab override は first version の対象外とし、Markdown は従来どおり note として扱いたい
* first version の viewer renderer は `iframe` ベースの read-only preview でよく、編集や block 実行とは契約を分けたい
* 実装の主対象は少なくとも以下
  - `src/shared/plugins.ts`
  - `src/main/pluginRegistry.ts`
  - `src/main/workspaceService.ts`
  - `src/main/integralWorkspaceService.ts`
  - `src/renderer/WorkspaceFileViewer.tsx`
  - `src/renderer/IntegralAssetDialogs.tsx`
* 関連設計文書として、少なくとも `docs/30_設計/50_プラグイン定義.md` と `docs/30_設計/40_標準描画と結果閲覧.md` を current 方針へ合わせて維持したい
* 2026-04-16 実装:
  - `src/shared/plugins.ts` に `viewers` contribution、viewer message model、viewer metadata 型を追加した
  - plugin manifest parse を `blocks` または `viewers` のどちらかを持てば成立する形へ広げ、既存 plugin 互換を維持した
  - `src/main/pluginRegistry.ts`, `src/main/main.ts`, `src/main/preload.ts`, `src/shared/workspace.ts` を更新し、`loadPluginViewerDocument(pluginId, viewerId)` を追加した
  - `src/main/workspaceService.ts` で非 `.md` workspace file を開くとき、拡張子に一致する plugin viewer を built-in より先に解決するようにした
  - `src/main/integralWorkspaceService.ts` でも dataset inspection / renderable 判定に同じ viewer registry を使い、plugin viewer 対象 file を標準表示 block で扱えるようにした
  - `src/renderer/ExternalPluginFileViewer.tsx` を追加し、viewer iframe へ file payload を postMessage で渡す generic renderer を実装した
  - `src/renderer/WorkspaceFileViewer.tsx` と `src/renderer/IntegralAssetDialogs.tsx` を更新し、`kind === "plugin"` の file を app 内で表示できるようにした
  - `src/renderer/workspaceEmbedFeature.tsx` は plugin viewer file の embed を明示的に未対応扱いにした
  - `src/renderer/PluginManagerDialog.tsx` で viewer 数を表示し、`src/renderer/styles.css` で plugin iframe style を一般 viewer でも使えるようにした
  - `npm run build` が通ることを確認した

## [x] 28. `.idts` source dataset manifest の built-in viewer を追加したい
- Status:completed
- 優先重み:5
- 記載日時:2026-04-16-10:34(UTC+9)

* `.idts` を単なる text ではなく source dataset manifest 専用 viewer で開きたい
* 表示内容は少なくとも、データファイル名、開けるリンク、対応するノートの埋め込み表示を含めたい
* plugin viewer system とは独立の built-in viewer とし、既存 plugin には影響させたくない
* 実装対象は workspace file open 経路と read-only viewer のみでよい
* 2026-04-16 実装:
  - `src/shared/workspace.ts` に `.idts` 用の `dataset-json` viewer kind と manifest view model を追加した
  - `src/main/integralWorkspaceService.ts` に `.idts` manifest を解決し、member metadata と dataset note 本文を束ねて返す special document reader を追加した
  - `src/main/main.ts` の `workspace:readFile` で `.idts` を intercept し、special document が解決できる場合は built-in viewer model を返すようにした
  - `src/renderer/DatasetManifestFileViewer.tsx` を追加し、member 一覧と note preview を表示する専用 viewer を実装した
  - `src/renderer/ReadonlyMarkdownPreview.tsx` を追加し、read-only Markdown preview を共通化した
  - `src/renderer/WorkspaceFileViewer.tsx`, `src/renderer/App.tsx`, `src/renderer/workspaceEmbedFeature.tsx`, `src/renderer/styles.css` を更新し、`.idts` 表示と readonly tab の extra model 保持に対応した
  - `docs/30_設計/40_標準描画と結果閲覧.md` に `.idts` built-in viewer を追記した
  - `npm run build` が通ることを確認した
* 2026-04-16 追記:
  - `.idts` viewer の埋め込み note preview 全体を clickable にし、クリックまたは Enter / Space で対応する managed data note を別タブで開けるようにした
  - `src/renderer/DatasetManifestFileViewer.tsx` で `requestOpenManagedDataNote()` を飛ばす導線を追加した
  - `src/renderer/styles.css` で note preview card の hover / focus と pointer event 制御を追加した
  - `npm run build` が通ることを確認した

## [x] 29. viewer plugin を `![]()` の embed preview にも適用したい
- Status:completed
- 優先重み:5
- 記載日時:2026-04-16-10:59(UTC+9)

* note 本文で workspace file を `![](/path)` 埋め込みしたときも、plugin viewer が解決できるなら app 内 preview を出したい
* embed 導線でも file tab と同じ viewer registry を使い、`plugin viewer -> built-in viewer -> unsupported` を揃えたい
* 初版の embed は preview-only でよく、詳細操作は surface click で通常の file tab を開く導線に寄せたい
* plugin viewer 側が必要なら、embed と full viewer の文脈を区別できるようにしたい
* 2026-04-16 実装:
  - `src/shared/plugins.ts` に `presentation: "embed" | "full"` を追加し、viewer renderer message で表示文脈を渡せるようにした
  - `src/renderer/ExternalPluginFileViewer.tsx` を更新し、full viewer と embed preview の両方で同じ iframe viewer を再利用できるようにした
  - `src/renderer/workspaceEmbedFeature.tsx` で `kind === "plugin"` を embed preview として描画し、未対応扱いをやめた
  - embed では `presentation="embed"` を viewer plugin へ渡しつつ、surface click / Enter / Space で通常の workspace file tab を開く構成を維持した
  - `src/renderer/styles.css` に plugin embed 用 style を追加し、iframe 自体は pointer event を持たず preview-only で見せるようにした
  - `src/renderer/WorkspaceFileViewer.tsx` と `src/renderer/IntegralAssetDialogs.tsx` では `presentation="full"` を渡すようにした
  - `docs/30_設計/40_標準描画と結果閲覧.md` と `docs/30_設計/50_プラグイン定義.md` に embed 方針を追記した
  - `npm run build` が通ることを確認した

## [ ] 30. Milkdown の link/embed 補完候補から hidden file を除外したい
- 優先重み:4
- 記載日時:2026-04-16-18:05(UTC+9)

* 現状の補完候補は explorer の hidden 表示状態に依存しており、hidden 表示を有効にすると `.store/.integral/data-notes/*.md` のような system-managed file まで候補に混ざりうる
* note 本文の link / embed 補完対象は、hidden 表示 state に関わらず user-facing な通常 workspace file に限定したい
* 少なくとも `.store/` 配下や hidden path は候補から除外し、`data-note` を file path として挿入させないようにしたい
* `[` 補完と `![` / `!` 補完で同じ filtering policy を使いたい
* explorer の hidden toggle は tree 表示専用の状態とし、Milkdown 補完候補の集合とは切り離したい
