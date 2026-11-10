# Rebuilds the download zips in .\downloads and the app icons in .\assets from the app projects.
# Run from anywhere:  powershell -File build-downloads.ps1
# PantryPip is packaged with `git archive` of the files git tracks, as they are on disk
# (no node_modules, .env, databases or other untracked/ignored files).
# Opt Out: only its logo is copied here; its Windows app is a GitHub release (RameVan/optout-releases)
# and Unsubscriber/desktop/publish.mjs updates its card in index.html on every release.
$ErrorActionPreference = 'Stop'
$site = $PSScriptRoot
$apps = Split-Path $site -Parent
$out = Join-Path $site 'downloads'
$assets = Join-Path $site 'assets'
New-Item -ItemType Directory -Force $out, $assets | Out-Null

# Turndown (in the CookieDenier folder): no git repo, zip the extension folder itself
$cd = Join-Path $apps 'CookieDenier'
$cdVersion = (Get-Content (Join-Path $cd 'manifest.json') -Raw | ConvertFrom-Json).version
Compress-Archive -Path (Join-Path $cd '*') -DestinationPath (Join-Path $out "turndown-$cdVersion.zip") -Force
Copy-Item (Join-Path $cd 'icons\turndown.svg') (Join-Path $assets 'turndown.svg') -Force

foreach ($app in @(
  @{ Dir = 'PantryPip'; Name = 'pantrypip'; Icon = 'web\public\icon.svg' }
)) {
  $repo = Join-Path $apps $app.Dir
  $version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
  # `git stash create` snapshots uncommitted changes to tracked files without touching the repo
  $tree = git -C $repo stash create
  if (-not $tree) { $tree = 'HEAD' }
  git -C $repo archive --format=zip --prefix="$($app.Name)/" -o (Join-Path $out "$($app.Name)-$version.zip") $tree
  if ($LASTEXITCODE) { throw "git archive failed for $($app.Dir)" }
  Copy-Item (Join-Path $repo $app.Icon) (Join-Path $assets "$($app.Name).svg") -Force
}

# Opt Out (in the Unsubscriber folder): logo only for now. When it's ready, add it to the loop above
# and zip its extension\ folder as optout-extension-<version>.zip.
Copy-Item (Join-Path $apps 'Unsubscriber\extension\icons\icon.svg') (Join-Path $assets 'optout.svg') -Force

Get-ChildItem $out | Select-Object Name, @{ n = 'KB'; e = { [math]::Ceiling($_.Length / 1KB) } }
Write-Host 'If a version changed, update the download links in index.html.'
