# Constellations Wiki

A static wiki built from the Players Guide. Edit the guide, drop the new `.docx` into `source/`, and the site rebuilds itself.

## One-time setup
1. Create a new GitHub repository (public, so free GitHub Pages works) and upload everything in this folder.
2. In the repository, open Settings, then Pages, and set Source to **GitHub Actions**.
3. Push to `main`. The workflow in `.github/workflows/pages.yml` builds the site and publishes it. The address appears under Settings, then Pages.

## Updating the guide
Replace `source/guide.docx` with the newer file (keep the name `guide.docx`) and commit. The site rebuilds in about a minute.

## Settings you may want to change
- `build_site.py`: `INCLUDE_WORLD = False` hides the World Bible section. Set it to `True` when that section is finished.
- `build_site.py`: `GROUPS` controls the sidebar order and headings.
- `assets/wiki.css`: colors are the Pastel Aurora palette, light and dark.

## Building locally
Needs `pandoc` and `pip install beautifulsoup4`. Run `python3 build_site.py`, then serve `docs/` with `python3 -m http.server`.
