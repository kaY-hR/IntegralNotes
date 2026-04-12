# Python実行基盤: `debugpy` vs `jupyter kernel`

## この文書の目的

- Python 解析実行基盤として `debugpy` または `jupyter kernel` を使う方向性を比較する。
- 商用利用の観点と、IntegralNotes への組み込み設計の観点を切り分けて整理する。
- 結論として、何を「主実行基盤」にし、何を「補助機能」に置くべきかを明確にする。

2026-04-12 時点での調査に基づく。

## 先に結論

- `debugpy` は主実行基盤には向かない。位置付けはあくまで「Python プロセスへ後付けで付与するデバッガ」である。
- `jupyter kernel` は主実行基盤になり得る。ただし、それは「単なる Python 実行」ではなく「状態保持付きセッション実行」を採ることを意味する。
- IntegralNotes の現時点の構想では、主軸は依然として「file-in / file-out の plugin 実行」に置くのが安全である。
- その上で、将来的な発展先として
  - `debugpy`: 開発者向けデバッグ補助
  - `jupyter kernel`: 高度な Python 解析 plugin 用のオプション実行モード
  として扱うのが筋が良い。

## 商用利用の観点

## `debugpy`

- PyPI 上の `debugpy` 1.8.20 は 2026-01-29 公開。
- ライセンスは MIT。
- Microsoft 製だが、OSS ライブラリとして商用利用自体は問題になりにくい。

実務上の注意:

- ライセンス面は比較的軽い。
- ただし、listen ポートを外部公開すると、接続者がデバッグ対象プロセス内で任意コード実行できる設計になっているため、運用上の安全策は必須。

## `jupyter kernel`

Jupyter を使う場合は、実際には最低でも次の層を見る必要がある。

- `jupyter-client`
- `ipykernel`
- 必要に応じて `jupyter_server` や `jupyterlab`

2026-04-12 時点の主要パッケージ:

- `jupyter-client` 8.8.0, 2026-01-08, BSD 3-Clause
- `ipykernel` 7.2.0, 2026-02-06, BSD-3-Clause
- Project Jupyter 全体としても、公式サイトでは modified BSD license とされている

したがって、少なくともコア部分については商用利用しやすい。

ただし注意点は 2 つある。

1. 「Jupyter のコードが使える」ことと、「Jupyter の名前を製品名に含めてよい」ことは別問題である。
2. 実際に同梱する依存パッケージ一式については、最終的に SBOM / license audit が必要である。

商標面では、Project Jupyter の公式ポリシー上、

- 「Jupyter を使っている」
- 「Jupyter と互換である」
- 「Jupyter を含む」

と正確に記述すること自体は、商用・非商用を問わず原則許容される。  
一方で、製品名や会社名に `Jupyter` を入れるような使い方には承認が必要になり得る。

## 設計面での本質的な違い

## `debugpy` は何か

`debugpy` は Python 向けの Debug Adapter Protocol 実装であり、要するに「実行中の Python をデバッグするための口」である。

できること:

- ブレークポイント
- step 実行
- 変数参照
- attach / listen

できないこと、または本質ではないこと:

- 解析 step の入出力モデル定義
- 実行履歴の永続化
- rich output の標準化
- セッション管理
- 複数 frontend からの状態同期
- notebook 的な execution counter や IOPub ストリーム

つまり `debugpy` は、「Python プロセスのデバッグ手段」ではあっても、「解析プラットフォームの実行モデル」ではない。

IntegralNotes に当てはめると、`debugpy` は次のような用途に限定するのが自然である。

- `Python実行Plugin` の開発中に attach する
- 高度ユーザー向けに「この run を debugger 付きで起動する」を提供する

逆に、これを主実行基盤にすると、

- 何を input とするか
- output をどう受け取るか
- 中間結果をどう残すか
- run をどう再現するか

は何も解決しない。

## `jupyter kernel` は何か

`jupyter kernel` は、長寿命の計算プロセスと、そのプロセスへ接続するためのメッセージング規約である。

Jupyter の公式仕様では、

- kernel は長く生きる
- frontend は kernel へ execute request を送る
- stdout / stderr / 実行結果 / debug event は IOPub などのチャネルで流れる
- 1 つの kernel に複数 frontend が同時接続できる

というモデルを取る。

これは IntegralNotes が欲しがっている次の要求にはかなり相性が良い。

- Python セッションをまたいだ変数保持
- 逐次的な試行錯誤
- 可視化結果や途中出力の逐次受信
- 実行中断 / 再起動

一方で、導入すると app 側の責務は一段重くなる。

必要になるもの:

- kernel の起動 / 停止 / interrupt / restart
- kernelspec や Python 環境の管理
- execute request / reply / IOPub の橋渡し
- `input()` をどう扱うかの方針
- どこまで状態を保持し、どこから file に落とすかの境界設計
- セッションが壊れたときの復旧方針

つまり、`jupyter kernel` は便利な代わりに「ただ Python を 1 回起動する」以上のシステムを背負う。

## `ipykernel` と `debugpy` の関係

ここは重要で、対立関係ではない。

- `jupyter kernel` は実行基盤
- `debugpy` はデバッグ機能

実際、`ipykernel` の API には debugger 関連の実装があり、内部的に `debugpy` と接続する前提が見える。

したがって、もし Jupyter 路線を採るなら、

- 通常実行は `ipykernel`
- デバッグ時だけ `debugpy`

という重ね方が自然である。

## IntegralNotes に当てるとどうなるか

## 1. `debugpy` 主軸案

これは非推奨。

理由:

- blob / artifact / run / workspace の設計課題を何も吸収しない
- plugin 契約も大きく楽にはならない
- file ベース chain の監査性や再現性も改善しない
- むしろ「デバッグ用ポート管理」という新しい責務だけ増える

要するに、主軸を `debugpy` に変えても本質は解けない。

## 2. `jupyter kernel` 主軸案

これは成立し得るが、かなり設計思想が変わる。

この案で本体が持つべき責務:

- kernel session のライフサイクル管理
- 実行リクエストのキューイング
- 実行結果ストリームの UI 反映
- セッションの workspace 紐付け
- セッション終了時の成果物確定

この案の利点:

- notebook 的な対話実行がやりやすい
- stateful な Python 解析が自然に書ける
- 逐次可視化や exploratory analysis に強い

この案の弱点:

- 再現性が file-in / file-out より弱くなりやすい
- 暗黙状態に依存した解析が増える
- 「どの変数状態でその図が出たのか」が曖昧になりやすい
- ELN 本体が notebook runtime の責務を背負い始める

つまり、これは ELN を Jupyter 系 IDE に一歩近づける選択であり、軽量な解析 host からは離れる。

## 3. ハイブリッド案

現実的にはこれが最も良い。

- 正式な解析チェーンは file-in / file-out を正とする
- `Python実行Plugin` の標準モードも file-in / file-out にする
- ただし高度機能として `KernelSession` モードを追加できるようにする
- `debugpy` はそのどちらにも付けられるデバッグ補助として扱う

これなら、

- 監査性と再現性は file ベースで確保できる
- exploratory な試行錯誤も将来取り込める
- Jupyter を採用しても ELN 全体が notebook 化しすぎない

## plugin 契約に何が増えるか

もし `jupyter kernel` を採るなら、現在の

- `params` 更新
- 単発 action 実行
- `summary` + `logLines`

だけでは足りない。

最低でも次が必要になる。

### 実行セッション

- `sessionId`
- `sessionMode`
  - `process`
  - `kernel`
- `workspaceId`
- `kernelSpec` または Python 環境指定

### 実行制御

- `run`
- `interrupt`
- `restart`
- `dispose`

### ストリーミング出力

- stdout / stderr
- rich display
- progress
- execution state

### 成果物の確定

- session 内の一時状態を、どのタイミングで file / artifact に落とすか
- その成果物を note にどう参照させるか

これはつまり、plugin 契約が「block action API」から「解析 runtime API」に一段進化することを意味する。

## 推奨方針

現時点の IntegralNotes には次を推奨する。

1. 主実行基盤は file-in / file-out のまま維持する。
2. `debugpy` は主実行基盤には採らず、開発・高度デバッグ用オプションに留める。
3. `jupyter kernel` は将来拡張の有力候補として設計余地を残す。
4. もし採るなら、ELN 本体へ直入れではなく、解析モジュール側の責務として切り出す前提で考える。

特に 4 が重要で、Jupyter 路線は便利だが、workspace / session / stream / interrupt / recovery をまとめて抱えるため、ELN 本体の責務としては重い。

したがって、

- ELN 本体: note, artifact, frontmatter, block 配置, 参照 UI
- 解析モジュール: process runner, kernel runner, session lifecycle, output capture

という分離の方が設計的に綺麗である。

## 実装優先度の提案

### Phase 1

- 現行案どおり、workspace 上の file-in / file-out 実行を成立させる
- artifact 参照と run 記録を整える

### Phase 2

- `Python実行Plugin` に developer-only な `debugpy` attach モードを追加する
- これはユーザー向け機能というより、plugin 開発支援

### Phase 3

- `KernelSessionRunner` を別 plugin / 別モジュールとして試作する
- 対話実行の利点が本当に大きいユースケースでのみ使う

この順番なら、先に必要な監査性と実用性を確保しつつ、Jupyter 的な発展余地も失わない。

## 参考

- debugpy PyPI: https://pypi.org/project/debugpy/
- debugpy GitHub: https://github.com/microsoft/debugpy
- jupyter_client Messaging spec: https://jupyter-client.readthedocs.io/en/stable/messaging.html
- jupyter_client kernels: https://jupyter-client.readthedocs.io/en/stable/kernels.html
- jupyter_client API: https://jupyter-client.readthedocs.io/en/stable/api/jupyter_client.html
- ipykernel PyPI: https://pypi.org/project/ipykernel/
- Project Jupyter About: https://jupyter.org/about
- Project Jupyter Trademark Policy: https://jupyter.org/governance/trademarks/
