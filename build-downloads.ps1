# Rebuilds the download zips in .\downloads and the app icons in .\assets from the app projects.
# Run from anywhere:  powershell -File build-downloads.ps1
# PantryPip and Opt Out are packaged with `git archive` of the files git tracks, as they are on disk
# (no node_modules, .env, databases or other untracked/ignored files).
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
  @{ Dir = 'PantryPip'; Name = 'pantrypip'; Icon = 'web\public\icon.svg' },
  @{ Dir = 'Unsubscriber'; Name = 'optout'; Icon = 'extension\icons\icon.svg' }
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

# Opt Out's browser extension on its own, built for a copy running on http://localhost:8790
$oo = Join-Path $apps 'Unsubscriber'
$ooVersion = (Get-Content (Join-Path $oo 'extension\manifest.json') -Raw | ConvertFrom-Json).version
Compress-Archive -Path (Join-Path $oo 'extension\*') -DestinationPath (Join-Path $out "optout-extension-$ooVersion.zip") -Force

Get-ChildItem $out | Select-Object Name, @{ n = 'KB'; e = { [math]::Ceiling($_.Length / 1KB) } }
Write-Host 'If a version changed, update the download links in index.html.'
