# IntegralNotes 仮実装

## 概要

IntegralNotesは「考察支援プラットフォームソフト」のELN(電子実験ノート)部分を担うElectronデスクトップアプリ。
研究者が実験ノートを唯一のインターフェースとして、分析データの閲覧・解析実行・考察・レポート作成を一気通貫で行えるようにする。

**コンセプト**: 非エンジニアでも使える、実験ノート特化のObsidian / コードフリーのJupyter Notebook

## リポジトリ

`C:\Users\shimadzu\Desktop\_Root\10_Integral\IntegralNotes` (GitHub: kawai-harunori-mc9_smzg/IntegralNotes)

## 機能

Obsidianと違うのは下記

例えば、
```itg-notes
{
  "type":"LC.Method.GradientEditor"
}
```
を挿入することで、IntegralNotes上ではグラジエント設定パネルが挿入されて見える

```itg-notes
{
  "type":"StandardGraphs.Chromatogram",
  "params":{
    "data":["lc1.lcd","lc2.lcd"]
  }
}
```
を挿入することで、IntegralNotes上ではクロマトのグラフパネルが挿入されて見える。

## アプリ構成

- サイドバー: Notesフォルダ下のフォルダ/ファイルツリー表示
- ノート(md)の作成・編集・削除・リネーム
- ノート内に分析データや解析結果(グラフ等)を挿入可能
- **WYSIWYGエディタ** (Markdownベース)
