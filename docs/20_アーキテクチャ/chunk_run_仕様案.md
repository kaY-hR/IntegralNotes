# chunk/run 仕様案（Dataflow MVP）

## 背景と目的

解析実行環境の議論を踏まえ、MVPでは概念を最小化しつつ、次を両立する。

- ユーザーが「結果を選んで解析する」UXを維持する
- 前回結果・他ノート結果の再利用を可能にする
- 実行の再現性と追跡可能性を担保する
- ELN本体に過度な実行責務を持ち込まない

## 基本方針

1. `chunk` は実質 `blob` と同等の保存単位として扱う（`chunk = blob` 方針）。
2. 解析・可視化の入力は `chunkId` を受け取る。
3. 解析の出力は新しい `chunk` として保存する（immutable運用）。
4. 実行は `run` 単位で記録する。
5. `sandbox` は実行時一時領域であり、ノートとの直接結合はしない。
6. ノート側は block から `run` を参照する。

## ディレクトリ運用（MVP）

### 永続データ側

- ワークスペース配下に `.chunk/` を置く
- `.chunk/<chunkId>/` が1つのchunkフォルダ
- chunk内には任意で `manifest.json` を置ける
- `artifact.md` により、chunkの内容説明・表示定義を管理可能

### ローカル実行側

- `LocalAppData/<AppName>/ProgramMasters/` に解析プログラムのmasterを配置
- `LocalAppData/<AppName>/SandboxRuns/<runId>/` を実行時に作成
- 実行時はmasterをsandboxへコピーして実行

## 実行フロー

1. blockが `scriptRef`（外部参照）と `inputChunkIds` を持つ
2. run開始時に `runId` を発行し、sandboxフォルダを作成
3. `scriptRef` を解決し、sandboxへ実行ファイルを配置
4. Pythonには `chunkId` もしくは解決済みchunk path群を入力として渡す
5. 実行結果を `.chunk/<newChunkId>/` に保存
6. run recordに `inputChunkIds` / `outputChunkIds` / `scriptRef` を記録
7. blockは `latestRunId` 参照を更新（sandbox参照は持たない）
8. sandboxは通常削除（失敗時保持オプションは将来追加）

## 参照モデル

- `note/block -> run`
- `run -> input chunks`
- `run -> output chunks`

※ sandboxは内部実装詳細であり、長期参照対象にしない。

## ID方針

- UUIDの全面採用は可読性観点で避ける
- 表示用短縮IDと内部IDの分離を推奨
  - 内部ID: 衝突耐性を優先（10〜16文字程度）
  - 表示ID: 5〜7桁程度でUI表示

## 可視化方針

- 普段のUXは「結果カード中心」
- 依存関係は run記録のスキャンでグラフ再構築可能
- React Flow的な可視化は段階導入とする

## Notebook方式との関係

Notebook方式はUXとして魅力があるが、MVPではDataflow方式を採用する。
ただし将来、同一基盤（run/chunk記録）上でNotebook風UIを提供する余地は残す。

## 非目標（MVP外）

- Jupyter Notebook完全互換UI
- 高度なセッション常駐管理
- 厳密な環境再現（コンテナ/lock含む）

## 未決定事項

- chunkId/ runId の具体的生成規則
- sandbox失敗時保持のポリシー（TTL/手動）
- manifest.json の必須項目
