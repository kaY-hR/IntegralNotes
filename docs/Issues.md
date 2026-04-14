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
* 2026-04-14 調査: 実現性は高い。現在の `.md` 読込・保存は `src/main/workspaceService.ts` の `readNote() / saveNote()` に集約されており、主変更点は renderer 側の markdown tab に editor mode を足すことになる
* 現状の `src/renderer/App.tsx` は markdown tab の `content` / `savedContent` / dirty 判定 / `Ctrl+S` 保存を 1 本化しているため、`WYSIWYG` と `raw markdown` の 2 UI が同じ文字列 state を共有すれば、tab 管理や保存導線はほぼ再利用できる
* 実装方針としては、`OpenMarkdownTab` に `editorMode: "wysiwyg" | "raw"` を持たせ、`editorFactory` で `MilkdownEditor` と軽量な plain text editor を切り替える構成が最もクリーン
* 注意点として、`src/renderer/MilkdownEditor.tsx` は mount 時の `initialValue` で初期化する非制御 component なので、`raw -> WYSIWYG` 切替時は mode を `key` に含めて再生成する設計にする必要がある
* Integral 独自 block は `itg-notes` fenced code block として markdown に保存されており、raw mode で直接編集しても保存経路自体は壊れない。内容が不正でも WYSIWYG 側では custom block view 内で parse error として扱えるため、設計上は許容しやすい
* 一方で `data-catalog/` 配下の data-note は、Issue 10 の方針により frontmatter を app 上で隠し、本文だけを editor / viewer に渡す設計になっている。そのため「生のマークダウン」を full file と解釈すると current 方針と衝突する
* そのため clean に進めるなら、まずは `通常ノートは raw markdown 切替を許可する / data-note は本文 raw のみ、または raw 切替対象外にする` のどちらかに限定するのがよい
* 先に full-file raw 編集まで求めると、Issue 10 の frontmatter 隠蔽方針、保存時の managed metadata merge、user-facing UX をまとめて再設計する必要があり、Issue 3 単体としては重くなる
* 結論として、`通常 markdown note 向けの source editing mode` として切るなら技術的にも設計的にもかなりクリーンに実装できる。反対に `data-note frontmatter も含めた完全な生ファイル編集` を要求するなら、別 Issue として分離した方がよい

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

## [ ] 20. frontmatter 分離を `data-catalog` 限定ではなく cwd 全体の標準動作にしたい
- 優先重み:5
- 記載日時:2026-04-14-17:04(UTC+9)

* 現状の frontmatter 分離は、少なくとも `workspaceService.ts` 上は `data-catalog` 配下の note だけに限定されていそう
* `gray-matter` もしくは同等の安定した frontmatter parser を使い、`cwd` 配下の Markdown 全体で frontmatter と本文を標準的に分離したい
* 読み込み時は frontmatter を保持したまま、editor / viewer には本文だけを渡したい
* 保存時は本文だけを更新し、既存 frontmatter は壊さず保持したい
* `data-catalog` 専用実装ではなく、通常 note でも frontmatter を自然に使えることを目標にしたい
* `data-note` 専用 metadata の扱いと、一般 Markdown の任意 frontmatter の扱いをどう両立するか整理したい

## [ ] 21. dataset の data-note 本文に canonical data へのリンクを入れたい
- 優先重み:4
- 記載日時:2026-04-14-17:07(UTC+9)

* dataset の data-note を自動生成するとき、本文に dataset 実体へのリンクを入れたい
* human-friendly な label と canonical path を両方持てるリンク表現にしたい
* 少なくとも source dataset / derived dataset の両方で一貫した本文テンプレートにしたい
* frontmatter だけでなく本文からも実体へ辿れるようにして、catalog note を起点に dataset を開きやすくしたい
* 候補は `標準 Markdown link`, `wiki link`, `app 専用 action` なので、どれを canonical にするかを整理したい
* `通常 note -> workspace file` の link 仕様は `docs/30_設計/60_ノートリンク記法.md` で分離したため、本 Issue では `data-note -> canonical data` に限定して考える

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

## [ ] 23. Milkdown の画像挿入 / 画像貼り付けで blob URL ではなく workspace 永続画像を保存したい
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
