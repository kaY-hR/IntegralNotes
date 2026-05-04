# Dummy Vendor external Python sample

LocalAppData install と external Python discovery の確認用 dummy folder です。

このサンプルは IntegralNotes の runtime plugin manifest を使いません。vendor が配布する
plugin っぽい folder に `.py` を置き、bat で `%LocalAppData%` へ展開するだけの MVP
確認用です。

## Install

```bat
install-localappdata.bat
```

展開先:

```text
%LocalAppData%\IntegralNotes\plugins\dummy-vendor
```

`blocks/demo_report.py` は `@integral_block` 付きなので、展開後は `>` popup の Python 解析候補にも出ます。
