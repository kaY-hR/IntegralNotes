# integral

IntegralNotes が Python callable 用に workspace へ置く小さな SDK package です。

- import: `from integral import integral_block`
- 配置先: `.integral-sdk/python/integral/`

この package は app が同期する system-managed な補助 package です。
通常の解析 script から import して使う想定です。

`.idts` dataset input は実行時に manifest file path として渡されます。
解析 script では必要に応じて次の helper を使います。

- `resolve_dataset_files(path)`: dataset member file の `Path` 一覧を返す
- `resolve_dataset_input(path)`: dataset を readable directory として扱う
- `prepare_dataset_output(path)`: `.idts` output directory を作成して返す
