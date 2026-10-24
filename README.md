# Aftertone

**Your music, rediscovered.** A local music-playlist app with warm retro colors and blocky computer typography. Connect Spotify or Apple Music, add album photos, review the matches, and create a playlist. AI-generated playlists are a future feature.

The repository/package name remains `discify`. Nothing is deployed or provisioned by this implementation.

## Local development

Use Node.js 24 and [uv](https://docs.astral.sh/uv/) with Python 3.11 or newer.

```sh
npm install
uv sync --project backend --python 3.11
cp backend/.env.example backend/.env
```

Run these in separate terminals from the repository root:

```sh
npm run dev -- --hostname 127.0.0.1
```

```sh
uv run --project backend uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:3000**. Use this hostname consistently for cookies and OAuth callbacks. The browser calls the Next.js `/api` gateway, which only forwards to the local backend. Override its default port with `AFTERTONE_BACKEND_ORIGIN` in an ignored `.env.local` if needed.

The app starts without provider credentials and displays unavailable-service/setup states. It does not substitute random recognition results or pretend to create playlists. See [backend setup](backend/README.md) for the encryption key, Spotify app, Apple Music developer credentials, and Gemini Pro/ADC configuration. Keep credentials in local ignored files; never paste them into source or commit them.

## Code quality first

VS Code workspace settings enable **format on save** and safe **fixes on save**:

- Prettier formats TypeScript, JavaScript, CSS, JSON and Markdown.
- ESLint checks Next.js, React and TypeScript.
- Ruff formats and lints Python, including import organization.

Recommended extensions are in `.vscode/extensions.json`: ESLint, Prettier, Python and Ruff. The Python interpreter points to `backend/.venv`. Auto-fixes run on explicit save; findings that need a judgment call remain visible. Prettier and ESLint use separate responsibilities, with `eslint-config-prettier` preventing style conflicts.

```sh
npm run check           # ESLint + formatting + TypeScript + unit tests
npm run lint:fix        # Apply safe ESLint fixes
npm run format         # Format supported repository files
npm run check:backend   # Ruff lint + format check + pytest
npm run format:backend  # Format Python
npm run test:browser   # Browser regressions; local frontend must be running
npm run build          # Verify the production frontend build locally
```

Write straightforward code with descriptive names and focused functions/components. Avoid dense one-line control flow, unnecessary abstractions, and disabling lint rules to hide findings. User-maintained agent settings, historical plans, generated assets and secrets are excluded from formatting.

ESLint is pinned to 9.39.5 because the installed React/JSX accessibility plugins still require ESLint 9; ESLint 10 was checked and is incompatible with those plugins. Revisit that pin when their compatibility changes. Existing Next.js 16.2.6 dependency advisories require a separate tested framework update; this tooling setup does not claim the dependency tree is audit-clean.

## Implementation status

The local first slice includes the API gateway, encrypted SQLite sessions, provider adapters, recognition input validation, catalog correction and conservative idempotent publishing. The frontend uses real API calls and handles missing configuration. Local publishing runs in one backend process; uncertain writes are not automatically replayed. Live Spotify/Apple authorization, Vertex calls and real playlist creation still require configured credentials and account acceptance testing. There is no deployed service or distributed job worker.

See [local progress and account setup blockers](docs/local-progress.md) for the latest features and remaining live acceptance work. Browser tests use intercepted API fixtures; run `npx playwright install chromium` if Chromium is not installed.

## Design and plans

- [Seven current Figma concepts](docs/design/aftertone-ui-mockups.md)
- [Brand direction](docs/design/aftertone-brand.md)
- [Frontend plan](docs/plans/aftertone-frontend.md)
- [Backend plan](docs/plans/aftertone-backend.md)
- [Agent instructions](AGENTS.md)

The app currently tries a self-hosted Jersey 10 display font; Figma explores Press Start 2P and VT323 as alternatives. Both follow the requested blocky computer direction. The earlier flowing logo remains a historical concept. Fonts retain their license under `public/fonts`.
