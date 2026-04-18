Chromatogram PCA
================

run: src/chromatogram_pca.py:main
input_json: my-LC-Samples.json
samples: 6
requested_components: 2
computed_components: 2
grid_size: 300
scale_features: False
rt_overlap: 0 - 10
explained_variance_ratio: PC1=87.67%, PC2=11.28%

generated_files:
- index.html
- summary.json
- scores.csv
- loadings.csv
- resampled_signals.csv
