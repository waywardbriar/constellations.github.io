# Constellations Wiki

A static wiki built from the Players Guide. Edit the guide, drop the new `.docx` into `source/`, and the site rebuilds itself.

## Updating the guide
Replace `source/guide.docx` with the newer file (keep the name `guide.docx`) and commit. The site rebuilds in about a minute.

## Settings you may want to change
- `build_site.py`: `INCLUDE_WORLD = False` hides the World Bible section. Set it to `True` when that section is finished.
- `build_site.py`: `GROUPS` controls the sidebar order and headings.
- `assets/wiki.css`: colors are the Pastel Aurora palette, light and dark.
