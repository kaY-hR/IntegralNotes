## 1. 表示の拡大縮小
優先重み:5

* ctrl+'-'で表示縮小できるのに、ctrl+'+'で拡大が出来ないため、一回縮小するとそれ以上拡大できなくなる
* ピンチアウトやホイールズームでも拡縮ができると望ましい

## 2. スラッシュコマンドメニューが残る
優先重み:2

スラッシュを打った状態でスラッシュコマンドメニューを開くと、その後エディタ内で他の箇所にカーソルを移さない限り、他のGUI部品をクリックしたりしてもスラッシュコマンドメニューが最前面に表示され続ける。可能なら、エディタ以外の部分にフォーカスを移した時点でスラッシュコマンドメニューは非表示にしたい、、が、milkdownの仕様ならちょっと対応は要検討

## 3.テキスト直編集
優先重み:1

可能なら、wiswigモード以外に、生のマークダウンファイルを編集できるモードに切り替えられると嬉しい

## 4.画像アップロードの保存先を設定でき、再オープン後も表示されるようにしたい
優先重み:10

* milkdown の画像挿入機能で貼り付けた画像が、保存内容として `blob:file:///...` 形式のまま残っている
* 現状はノートを再度開くと画像が表示されないため、milkdown 側だけでなく IntegralNotes 側でも永続化処理が必要そう
* トップバーのメニューに `[設定]` を追加したい
* `[設定]` をクリックすると、設定ダイアログを表示したい
* 設定ダイアログには `[アップロードファイルの保存場所]` を設けたい
* 保存場所は、ワーキングフォルダ内の任意のフォルダをドロップダウンで選べるようにしたい
* 保存場所の初期値は `Assets` フォルダにしたい
* `Assets` フォルダが存在しない場合は、最初にアップロードが走るタイミングで作成したい
* アップロードされたファイルは、設定で選ばれた保存先フォルダへ保存したい
* マークダウン内の画像リンクは、保存先フォルダ内の実ファイルを指すパスへ更新したい
* 相対パスで解決できるなら、マークダウンリンクは相対パスを優先したい

## 5. blob/chunk/block ベースの解析基盤を設計・実装したい
優先重み:9

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
優先重み:6

* `shimadzu-lc` の migration を進めたい
* `standard-graphs` は一旦削除してもよい
