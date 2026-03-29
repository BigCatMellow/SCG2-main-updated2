# StarCraft: TMG Companion

Mobile-first companion app for StarCraft: The Miniatures Game.

## Pages

- `index.html` — home / launcher
- `zerg.html` — Zerg army builder
- `protoss.html` — Protoss army builder
- `terran.html` — Terran army builder
- `missions.html` — missions and maps
- `rules.html` — rules reference

## GitHub Pages

1. Put the files in a GitHub repo.
2. In **Settings → Pages**, deploy from the `main` branch `/ (root)`.
3. Your site will be at `https://YOUR_USERNAME.github.io/REPO_NAME/`.

If needed, update `start_url` in `manifest.json` to match your repo name.

## Local Use

Open `index.html` in a browser.

For install / PWA behavior, use HTTPS or localhost, for example:

```bash
python -m http.server 8000
```

## Notes

Fan-made companion for StarCraft: The Miniatures Game.
StarCraft is a trademark of Blizzard Entertainment.
