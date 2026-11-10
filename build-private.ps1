# Builds the pre-release downloads for private.html into the PRIVATE repo RameVan/convenience-suite-private.
# Nothing here is written to this public site folder: unreleased builds must never be committed to it.
# Run:  powershell -File build-private.ps1          (build and commit in the private clone)
#       powershell -File build-private.ps1 -Push    (also push, which makes them downloadable)
#       -OptOutExe path\to\OptOut-x.y.z.exe            (the portable Windows app; default: newest in Unsubscriber\desktop\release)
# When an app goes public, remove it from $apps below, add it to build-downloads.ps1 and index.html.
param(
  [string]$Clone = (Join-Path $env:LOCALAPPDATA 'ConvenienceSuite\private'),
  [string]$OptOutExe,
  [switch]$Push
)
$ErrorActionPreference = 'Stop'
$site = $PSScriptRoot
$root = Split-Path $site -Parent

if (-not (Test-Path (Join-Path $Clone '.git'))) {
  New-Item -ItemType Directory -Force (Split-Path $Clone -Parent) | Out-Null
  git clone https://github.com/RameVan/convenience-suite-private.git $Clone
  if ($LASTEXITCODE) { throw 'Could not clone the private repo (is gh/git signed in as RameVan?)' }
  # Commit as the same person as the site repo, which sets its identity per repository
  foreach ($key in 'user.name', 'user.email') { git -C $Clone config $key (git -C $site config $key) }
} else {
  git -C $Clone pull --ff-only
}
$builds = Join-Path $Clone 'builds'
$icons = Join-Path $Clone 'icons'
Remove-Item $builds -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $builds, $icons | Out-Null

# Snapshot of the files git tracks, as they are on disk (no node_modules, .env or databases)
function Save-Source($repo, $name, $version) {
  $tree = git -C $repo stash create
  if (-not $tree) { $tree = 'HEAD' }
  $file = "$name-$version.zip"
  git -C $repo archive --format=zip --prefix="$name/" -o (Join-Path $builds $file) $tree
  if ($LASTEXITCODE) { throw "git archive failed for $repo" }
  "builds/$file"
}

$apps = @()
$dot = [char]0xB7  # " · " separator; Windows PowerShell reads this file as ANSI, so keep it ASCII

# Opt Out (in the Unsubscriber folder): the Chrome extension plus the web app source
$oo = Join-Path $root 'Unsubscriber'
$ooVersion = (Get-Content (Join-Path $oo 'extension\manifest.json') -Raw | ConvertFrom-Json).version
Compress-Archive -Path (Join-Path $oo 'extension\*') -DestinationPath (Join-Path $builds "optout-extension-$ooVersion.zip") -Force
$ooSource = Save-Source $oo 'optout' $ooVersion
# Add the double-click starter (private-extras\optout) next to the source, so no terminal is needed
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::Open((Join-Path $Clone $ooSource), 'Update')
try {
  Get-ChildItem (Join-Path $site 'private-extras\optout') -File | ForEach-Object {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, "optout/$($_.Name)") | Out-Null
  }
} finally { $zip.Dispose() }
Copy-Item (Join-Path $oo 'extension\icons\icon.svg') (Join-Path $icons 'optout.svg') -Force
# The portable Windows app is over GitHub's 100 MB file limit, so it goes up as a release asset of the
# private repo (on -Push) and the Worker serves it from releases/<tag>/<name>.
$ooFiles = @(
  [ordered]@{ label = 'Web app'; path = $ooSource },
  [ordered]@{ label = 'Extension'; path = "builds/optout-extension-$ooVersion.zip" }
)
$ooNote = 'To try it: unzip Web app and double-click "Start Opt Out" (needs Node.js 24 from nodejs.org). It opens in your browser (the first start takes a few minutes); choose "Use development fixture mailbox" to try it on test data. Not tried on a real mailbox yet.'
if (-not $OptOutExe) {
  $OptOutExe = Get-ChildItem (Join-Path $oo 'desktop\release\OptOut-*.exe') -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1 -ExpandProperty FullName
}
$exeRelease = $null
if ($OptOutExe) {
  $exeName = Split-Path $OptOutExe -Leaf
  $exeVersion = $exeName -replace '^OptOut-(.+)\.exe$', '$1'
  $exeRelease = @{ tag = "optout-desktop-$exeVersion"; file = $OptOutExe; version = $exeVersion }
  $ooFiles = @([ordered]@{ label = "Windows app $exeVersion"; path = "releases/optout-desktop-$exeVersion/$exeName" }) + $ooFiles
  $ooNote = 'Windows app: download and double-click, nothing is installed (Windows may warn "Windows protected your PC": choose More info, then Run anyway). It opens in your browser; unsubscribes in it are real. ' + $ooNote
}
$apps += [ordered]@{
  name = 'Opt Out'; tag = "Windows app $dot Web app $dot Chrome extension"; version = $ooVersion; icon = 'icons/optout.svg'
  colors = [ordered]@{ ink = '#b4541c'; a = '#f08a2c'; b = '#f6b73c' }
  desc = 'Clears the newsletters out of your Gmail: finds every mailing list, sorts them and unsubscribes in bulk while keeping important mail safe.'
  chips = @('Bulk unsubscribe', 'Protects important mail', 'Breach alerts')
  note = $ooNote
  files = $ooFiles
}

$json = [ordered]@{ apps = $apps } | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $Clone 'apps.json'), $json, [Text.UTF8Encoding]::new($false))
if (-not (Test-Path (Join-Path $Clone 'README.md'))) {
  [IO.File]::WriteAllText((Join-Path $Clone 'README.md'), "Pre-release builds for https://theconveniencesuite.com/private.html. Generated by build-private.ps1 in the site repo; keep this repository private.`n")
}

# Roster Reader (the RosterReader folder next to this one) is a web page, not a download: the Worker serves
# apps/roster-reader.html at dl.theconveniencesuite.com/roster-reader after sign-in (worker/src/roster.js).
$pages = Join-Path $Clone 'apps'
New-Item -ItemType Directory -Force $pages | Out-Null
Copy-Item (Join-Path $root 'RosterReader\roster-reader.html') (Join-Path $pages 'roster-reader.html') -Force

Get-ChildItem $builds | Select-Object Name, @{ n = 'KB'; e = { [math]::Ceiling($_.Length / 1KB) } }

# Upload release assets first, so the links in apps.json work as soon as it is pushed
if ($Push -and $exeRelease) {
  $repo = 'RameVan/convenience-suite-private'
  # Read the list from stdout: Windows PowerShell turns a native command's stderr into a fatal error here
  $tags = @(gh release list -R $repo --json tagName --jq '.[].tagName')
  if ($tags -notcontains $exeRelease.tag) {
    gh release create $exeRelease.tag $exeRelease.file -R $repo --title "Opt Out for Windows $($exeRelease.version)" --notes 'Portable Windows app. Pre-release; served by the private download page.'
  } else {
    gh release upload $exeRelease.tag $exeRelease.file -R $repo --clobber
  }
  if ($LASTEXITCODE) { throw 'Uploading the Windows app to the private repo failed' }
}
git -C $Clone add -A
git -C $Clone diff --cached --quiet
if ($LASTEXITCODE) {
  git -C $Clone commit -q -m "Update pre-release builds"
  if ($LASTEXITCODE) { throw "git commit failed in $Clone" }
  if (-not $Push) { Write-Host "Committed in $Clone. Run again with -Push (or git push there) to publish to the private repo." }
} else { Write-Host 'No changes.' }
# Push also when an earlier run already committed without -Push
if ($Push) { git -C $Clone push -u origin HEAD }
