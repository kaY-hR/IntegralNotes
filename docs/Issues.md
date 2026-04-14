## 1. 表示の拡大縮小
- Status:Yet
- 優先重み:5

* ctrl+'-'で表示縮小できるのに、ctrl+'+'で拡大が出来ないため、一回縮小するとそれ以上拡大できなくなる
* ピンチアウトやホイールズームでも拡縮ができると望ましい

## 2. スラッシュコマンドメニューが残る
- Status:Done
- 優先重み:2

スラッシュを打った状態でスラッシュコマンドメニューを開くと、その後エディタ内で他の箇所にカーソルを移さない限り、他のGUI部品をクリックしたりしてもスラッシュコマンドメニューが最前面に表示され続ける。可能なら、エディタ以外の部分にフォーカスを移した時点でスラッシュコマンドメニューは非表示にしたい、、が、milkdownの仕様ならちょっと対応は要検討

## 3.テキスト直編集
- Status:Done
- 優先重み:1

可能なら、wiswigモード以外に、生のマークダウンファイルを編集できるモードに切り替えられると嬉しい

## 5. blob/chunk/block ベースの解析基盤を設計・実装したい
- Status:Done
- 優先重み:9

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

## 6. shimadzu-lc migration を進めたい
- Status:?
- 優先重み:6

* `shimadzu-lc` の migration を進めたい
* `standard-graphs` は一旦削除してもよい

## 7. エクスプローラー / ノート表示を chunk viewer 相当に広げたい
- Status:?
- 優先重み:5

* エクスプローラーは `md` のみでフィルタせず、ワークスペース内の対象ファイルを全部表示したい
* 特にエクスプローラーの tree 構造側でも `.md` 限定フィルタが掛かっていそうなので外したい
* ノート部分のタブ表示でも `html / svg / image / text(json など)` を表示したい
* 要は `chunk viewer` と同等の表示系を main app 側にも導入したい
