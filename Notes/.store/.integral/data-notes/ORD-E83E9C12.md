---
integralNoteType: "data-note"
dataTargetType: "original-data"
managedDataId: "ORD-E83E9C12"
originalDataId: "ORD-E83E9C12"
entityType: "original-data"
displayName: "Output1.txt"
representation: "file"
path: "Data/LC_text_files/Output1.txt"
hash: "sha256:FD3367F1952E1E80D6F380476C228F7D41CC8EFD36A9F4C1AA48AB2A19D6AE0F"
visibility: "visible"
provenance: "source"
createdAt: "2026-04-17T09:03:10.493Z"
---
# Output1.txt

<br />

  `//下記、plotを出すために3blockも操作が必要。絶対にNG。。`

```itg-notes
id: BLK-80EF0424
run: src/lc_text_to_chromatogram_json.py:main
in:
  source: DTS-3F3AC664
params: {}
out:
  json: /.store/.integral/datasets/DTS-0CA91B3F.idts
```

```itg-notes
id: BLK-92463DC8
run: src/chromatogram_json_to_plotly_html.py:main
in:
  source: /.store/.integral/datasets/DTS-0CA91B3F.idts
params: {}
out:
  plot: /.store/.integral/datasets/DTS-05543811.idts
```

![](/.store/.integral/datasets/DTS-05543811.idts)

<br />

![](/.store/objects/DTS-05543811/index.html)

<br />

`//見切れていて見にくいし、そもそもクロマト1つ表示するのに手順がかかりすぎ。`

