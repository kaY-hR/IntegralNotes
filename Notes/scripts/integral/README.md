# integral

IntegralNotes が Python callable 用に workspace へ置く小さな SDK package です。

- import: `from integral import integral_block`
- 配置先: `scripts/integral/`

この package は app が同期する system-managed な補助 package です。
通常の解析 script から import して使う想定です。

## slot object で使える主な key

- `project_to_inputs`
- `auto_insert_to_work_note`
- `share_note_with_input` （output の data-note 共有先 input slot 名）
