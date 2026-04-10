Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $PSCommandPath
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptRoot '..'))
# Change this path when reusing the script.
# Keep this file encoded as UTF-8 with BOM if TargetRoot contains non-ASCII characters.
$targetRoot = [System.IO.Path]::GetFullPath('C:\Users\shimadzu\OneDrive - SHIMADZU\共有\Rutilea様共有フォルダ(表示のみ)\簡易ソフト\コード')
$excludeFilePath = Join-Path $scriptRoot '.copyexclude'
$manifestRelativePath = 'scripts/.copyexport-manifest'
$manifestPath = Join-Path $targetRoot ($manifestRelativePath.Replace('/', '\'))
$legacyManifestPath = Join-Path $targetRoot '.copyexport-manifest'
$internalExcludePaths = @(
  'scripts/.copyexclude',
  'scripts/copy-git-files.bat',
  'scripts/export-tracked-files.ps1'
)

function Normalize-RelativePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $normalized = $Path.Replace('\', '/')

  while ($normalized.StartsWith('./', [System.StringComparison]::Ordinal)) {
    $normalized = $normalized.Substring(2)
  }

  return $normalized.Trim('/')
}

function Test-IsPathInside {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ParentPath,
    [Parameter(Mandatory = $true)]
    [string]$ChildPath
  )

  $parentFullPath = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd('\')
  $childFullPath = [System.IO.Path]::GetFullPath($ChildPath).TrimEnd('\')

  if ($childFullPath.Equals($parentFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $true
  }

  return $childFullPath.StartsWith(
    $parentFullPath + [System.IO.Path]::DirectorySeparatorChar,
    [System.StringComparison]::OrdinalIgnoreCase
  )
}

function Get-ExcludePatterns {
  $patterns = New-Object System.Collections.Generic.List[string]

  if (Test-Path -LiteralPath $excludeFilePath -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $excludeFilePath -Encoding UTF8) {
      $trimmed = $line.Trim()

      if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#', [System.StringComparison]::Ordinal)) {
        continue
      }

      $patterns.Add((Normalize-RelativePath -Path $trimmed))
    }
  }

  foreach ($path in $internalExcludePaths) {
    $patterns.Add((Normalize-RelativePath -Path $path))
  }

  return $patterns | Sort-Object -Unique
}

function Test-IsExcluded {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RelativePath,
    [Parameter(Mandatory = $true)]
    [string[]]$ExcludePatterns
  )

  foreach ($pattern in $ExcludePatterns) {
    if ([string]::IsNullOrWhiteSpace($pattern)) {
      continue
    }

    if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($pattern)) {
      if ($RelativePath -like $pattern) {
        return $true
      }

      continue
    }

    if ($RelativePath.Equals($pattern, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }

    $directoryPrefix = $pattern.TrimEnd('/') + '/'

    if ($RelativePath.StartsWith($directoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }

  return $false
}

function Read-ManifestEntries {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$CandidatePaths
  )

  foreach ($path in $CandidatePaths) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      continue
    }

    return Get-Content -LiteralPath $path -Encoding UTF8 |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ } |
      ForEach-Object { Normalize-RelativePath -Path $_ } |
      Sort-Object -Unique
  }

  return @()
}

function Get-GitTrackedFiles {
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = 'git'
  $startInfo.Arguments = '-c safe.directory=* -c core.quotepath=false ls-files -z'
  $startInfo.RedirectStandardError = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.UseShellExecute = $false

  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  [void]$process.Start()

  $stdoutStream = New-Object System.IO.MemoryStream
  $process.StandardOutput.BaseStream.CopyTo($stdoutStream)
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()

  if ($process.ExitCode -ne 0) {
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
      throw $stderr.Trim()
    }

    throw 'Failed to read tracked files from git.'
  }

  $outputText = [System.Text.Encoding]::UTF8.GetString($stdoutStream.ToArray())

  return $outputText.Split([char]0) |
    Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
}

function Remove-EmptyDirectories {
  param(
    [Parameter(Mandatory = $true)]
    [string]$RootPath
  )

  if (-not (Test-Path -LiteralPath $RootPath -PathType Container)) {
    return
  }

  $directories = Get-ChildItem -LiteralPath $RootPath -Directory -Recurse |
    Sort-Object FullName -Descending

  foreach ($directory in $directories) {
    $firstChild = Get-ChildItem -LiteralPath $directory.FullName -Force | Select-Object -First 1

    if ($null -eq $firstChild) {
      Remove-Item -LiteralPath $directory.FullName -Force
    }
  }
}

if (Test-IsPathInside -ParentPath $repoRoot -ChildPath $targetRoot) {
  throw "Target path must be outside the repository: $targetRoot"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git command was not found.'
}

$trackedFiles = @(Get-GitTrackedFiles)

$excludePatterns = @(Get-ExcludePatterns)
$previousManifestEntries = @(Read-ManifestEntries -CandidatePaths @($manifestPath, $legacyManifestPath))
$currentManifestEntries = New-Object System.Collections.Generic.List[string]
$currentEntrySet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$copiedCount = 0
$skippedCount = 0
$removedCount = 0
$migratedLegacyManifest = $false

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

foreach ($trackedFile in $trackedFiles) {
  $relativePath = Normalize-RelativePath -Path $trackedFile

  if ([string]::IsNullOrWhiteSpace($relativePath)) {
    continue
  }

  if (Test-IsExcluded -RelativePath $relativePath -ExcludePatterns $excludePatterns) {
    $skippedCount += 1
    continue
  }

  $sourcePath = Join-Path $repoRoot $relativePath

  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    Write-Warning "Skipped non-file tracked path: $relativePath"
    continue
  }

  $destinationPath = Join-Path $targetRoot $relativePath
  $destinationDirectory = Split-Path -Parent $destinationPath

  if ($destinationDirectory) {
    New-Item -ItemType Directory -Force -Path $destinationDirectory | Out-Null
  }

  Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
  $currentManifestEntries.Add($relativePath)
  [void]$currentEntrySet.Add($relativePath)
  $copiedCount += 1
}

foreach ($oldEntry in $previousManifestEntries) {
  if ($currentEntrySet.Contains($oldEntry)) {
    continue
  }

  $stalePath = Join-Path $targetRoot $oldEntry

  if (Test-Path -LiteralPath $stalePath -PathType Leaf) {
    Remove-Item -LiteralPath $stalePath -Force
    $removedCount += 1
  }
}

$manifestDirectory = Split-Path -Parent $manifestPath

if ($manifestDirectory) {
  New-Item -ItemType Directory -Force -Path $manifestDirectory | Out-Null
}

Set-Content -LiteralPath $manifestPath -Value ($currentManifestEntries | Sort-Object -Unique) -Encoding UTF8

if ((Test-Path -LiteralPath $legacyManifestPath -PathType Leaf) -and ($legacyManifestPath -ne $manifestPath)) {
  Remove-Item -LiteralPath $legacyManifestPath -Force
  $migratedLegacyManifest = $true
}

Remove-EmptyDirectories -RootPath $targetRoot

Write-Host "Target: $targetRoot"
Write-Host "Copied: $copiedCount"
Write-Host "Excluded: $skippedCount"
Write-Host "Removed stale files: $removedCount"
Write-Host "Manifest: $manifestRelativePath"

if ($migratedLegacyManifest) {
  Write-Host 'Migrated legacy manifest from root to scripts/.copyexport-manifest'
}
