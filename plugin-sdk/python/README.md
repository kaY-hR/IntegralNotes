# Integral Python SDK

IntegralNotes の Python callable 向け SDK です。

現時点で提供する主 API:

- `integral.integral_block`
  - Python callable を IntegralNotes へ公開する decorator

最小例:

```python
from integral import integral_block


@integral_block(
    display_name="Hello Report",
    description="Generate a tiny HTML report.",
    outputs=["report"],
)
def main(inputs, outputs, params):
    ...
```

app 実行時は、この SDK を app 側 runner が `sys.path` へ追加して import を成立させる。  
開発時に手元の Python から明示的に import したい場合は、例えば次のように editable install できる。

```bash
pip install -e plugin-sdk/python
```
