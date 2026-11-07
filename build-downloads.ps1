# Rebuilds the download zips in .\downloads and the app icons in .\assets from the app projects.
# Run from anywhere:  powershell -File build-downloads.ps1
# PantryPip and Slate are packaged with `git archive`, so only committed files go in
# (no node_modules, .env, databases or other untracked/ignored files). Commit first to ship new changes.
$ErrorActionPreference = 'Stop'
$site = $PSScriptRoot
$apps = Split-Path $site -Parent
$out = Join-Path $site 'downloads'
$assets = Join-Path $site 'assets'
New-Item -ItemType Directory -Force $out, $assets | Out-Null

# Cookie Denier: no git repo, zip the extension folder itself
$cd = Join-Path $apps 'CookieDenier'
$cdVersion = (Get-Content (Join-Path $cd 'manifest.json') -Raw | ConvertFrom-Json).version
Compress-Archive -Path (Join-Path $cd '*') -DestinationPath (Join-Path $out "cookie-denier-$cdVersion.zip") -Force
Copy-Item (Join-Path $cd 'icons\icon128.png') (Join-Path $assets 'cookie-denier.png') -Force

foreach ($app in @(
  @{ Dir = 'PantryPip'; Name = 'pantrypip'; Icon = 'web\public\icon.svg' },
  @{ Dir = 'Slate';     Name = 'slate';     Icon = 'public\icon.svg' }
)) {
  $repo = Join-Path $apps $app.Dir
  $version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
  git -C $repo archive --format=zip --prefix="$($app.Name)/" -o (Join-Path $out "$($app.Name)-$version.zip") HEAD
  if ($LASTEXITCODE) { throw "git archive failed for $($app.Dir)" }
  Copy-Item (Join-Path $repo $app.Icon) (Join-Path $assets "$($app.Name).svg") -Force
}

Get-ChildItem $out | Select-Object Name, @{ n = 'KB'; e = { [math]::Ceiling($_.Length / 1KB) } }
Write-Host 'If a version changed, update the download links in index.html.'
