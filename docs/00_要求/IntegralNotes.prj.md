# IntegralNotes 仮実装

## 概要

IntegralNotesは「考察支援プラットフォームソフト」のELN(電子実験ノート)部分を担うElectronデスクトップアプリ。
研究者が実験ノートを唯一のインターフェースとして、分析データの閲覧・解析実行・考察・レポート作成を一気通貫で行えるようにする。

**コンセプト**: 非エンジニアでも使える、実験ノート特化のObsidian / コードフリーのJupyter Notebook

## リポジトリ

`C:\Users\shimadzu\Desktop\_Root\10_Integral\IntegralNotes` (GitHub: kawai-harunori-mc9_smzg/IntegralNotes)

## アプリ構成

### 画面構成

- **3タブ構成**: 「データ」「ノート」「プログラム」をflex-layoutで自由配置
- VSCode/Obsidianのようにフォルダを開いて使う
- Rootフォルダ構造:
  ```
  Data/
    raw-files/
    (自由)
  Notes/
    (自由)
  Programs/
    Workspaces/
    MasterFlows/
    MasterBlocks/
  ```

### データタブ
- サイドバー: Dataフォルダ下のフォルダ/ファイルツリー表示
- アイコン/ドラッグドロップでデータ登録
- ファイル選択 → 詳細閲覧・編集、サムネイル表示

### ノートタブ
- サイドバー: Notesフォルダ下のフォルダ/ファイルツリー表示
- ノート(md)の作成・編集・削除・リネーム
- ノート内に分析データや解析結果(グラフ等)を挿入可能
- **WYSIWYGエディタ** (Markdownベース)

### プログラムタブ
- 元々のIntegral(解析ソフト)をここに埋め込む
- **実行スペース**: ブロック=フォルダでコードが展開され、実行される
- **作成済フロー**: 実行スペースで作ったフローをテンプレ化、コピーして新スペースを作れる
- **作成済ブロック**: 実行スペースで作ったブロックを登録、D&Dで再利用

### ノートタブとプログラムタブの連携
- 同時に開いて同時に編集
- プログラムの実行結果をノートにドラッグドロップで挿入

## Notes機能詳細 (Notes機能詳細イメージ ベース)

ノート内でLLMアシスト付きの対話的データ解析が可能:
1. テキストで実験の目的・条件を記述
2. `>>` コマンドで解析指示（例: `Draw-Chromatogram`, `GetCompoundTable(...).Area.PCA`）
3. LLMがsuggest（グラジエント設定、データ選択、PCA実行など）
4. 結果（クロマトグラム、PCAプロット等）がノート内にインライン表示
5. 結果に対して考察を記述 → LLMが考察を補助

## データ管理

- 生データはData/raw-filesフォルダにフラットに配置
- ELN以外のmdも自由に置ける
- データ登録時にメタデータ(yaml frontmatter)を付与
  - data-type固定: md/frontmatterで直接管理
  - data-typeごとにyaml項目を定義、基本設定プロパティダイアログで設定
  - mdのYAML以降は自由記述、片手落ちのデータを検索するためにも使える
- 1フォルダ1テーブル方式（簡易DB）、data-typeごとにCRDB的に管理

## 技術スタック（仮実装方針）

- **フレームワーク**: Electron
- **フロントエンド**: React + TypeScript
- **エディタ**: TipTap (ProseMirror) or Monaco Editor
- **レイアウト**: FlexLayout (react-flexlayout等)
- **ファイル操作**: Node.js fs API
- **データ管理**: ファイルシステムベース (YAML frontmatter + md)

## 仮実装のスコープ

### Phase 1: 基盤UI
- [ ] Electronアプリの雛形作成
- [ ] 3タブ(データ/ノート/プログラム)のflex-layout UI
- [ ] フォルダオープン機能

### Phase 2: ノートタブ
- [ ] Notesフォルダのファイルツリー表示(サイドバー)
- [ ] Markdownノートの作成・編集・削除・リネーム
- [ ] WYSIWYG Markdownエディタ

### Phase 3: データタブ
- [ ] Dataフォルダのファイルツリー表示
- [ ] ファイル詳細閲覧(メタデータ表示)
- [ ] データ登録(D&D対応)
- [ ] YAML frontmatter によるメタデータ管理

### Phase 4: プログラムタブ (stub)
- [ ] 実行スペース/作成済フロー/作成済ブロックのUI骨格
- [ ] ブロックのフロー接続UIのプロトタイプ

### Phase 5: 連携機能
- [ ] プログラム結果 → ノートへのD&D挿入
- [ ] ノート内コマンド実行(`>>` 記法)のプロトタイプ
