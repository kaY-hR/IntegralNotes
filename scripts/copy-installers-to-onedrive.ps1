$SrcRoot = Split-Path $PSScriptRoot -Parent
$Dest = "C:\Users\shimadzu\OneDrive - SHIMADZU\共有\Rutilea様共有フォルダ(表示のみ)\簡易ソフト\成果物"

if (-not (Test-Path $Dest)) {
    Write-Error "Destination folder not found: $Dest"
    exit 1
}

$files = @(
    "$SrcRoot\out\IntegralNotes-Setup-0.1.0.exe"
    "$SrcRoot\plugins\dist\integralnotes.standard-graphs\integralnotes.standard-graphs-0.1.0.zip"
    "$SrcRoot\plugins\dist\shimadzu.lc\shimadzu.lc-0.1.0.zip"
)

Write-Host "Copying files to OneDrive..."
foreach ($file in $files) {
    if (-not (Test-Path $file)) {
        Write-Warning "Not found: $file"
        continue
    }
    Copy-Item -Path $file -Destination $Dest -Force
    Write-Host "  Copied: $(Split-Path $file -Leaf)"
}
Write-Host "Done."
