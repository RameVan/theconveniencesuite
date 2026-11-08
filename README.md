# The Convenience Suite

Source of [theconveniencesuite.com](https://theconveniencesuite.com): a static download page for my apps, hosted on GitHub Pages.

- `index.html`, `styles.css`: the page (black hero, 70s stripe band, light app cards for Turndown, PantryPip and Opt Out).
- `fonts/`: the self-hosted Newsreader headline font (SIL Open Font License), so the page makes no third-party requests.
- `downloads/`, `assets/`: app zips and icons, rebuilt by `build-downloads.ps1` from the app projects next to this folder.

- `private.html`, `private.css`, `private.js`: the owner sign-in (footer link "Owner sign-in") for apps that aren't public yet. The builds are **not** in this repo: `build-private.ps1` puts them in the private repo `RameVan/convenience-suite-private`, and the page downloads them from GitHub's API with a fine-grained read-only token pasted at sign-in. Never put unreleased builds in `downloads/`: everything here is public.

To update: run `build-downloads.ps1`, update versions in `index.html` if they changed, bump the `styles.css?v=` number in `index.html` when the CSS changed (browsers cache it for 10 minutes), then commit and push. The site redeploys automatically.
