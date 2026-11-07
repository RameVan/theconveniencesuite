# The Convenience Suite

Source of [theconveniencesuite.com](https://theconveniencesuite.com): a static download page for my apps, hosted on GitHub Pages.

- `index.html`, `styles.css`: the page (styled after the VanOS Forest theme).
- `downloads/`, `assets/`: app zips and icons, rebuilt by `build-downloads.ps1` from the app projects next to this folder.

To update: run `build-downloads.ps1`, update versions in `index.html` if they changed, then commit and push. The site redeploys automatically.
