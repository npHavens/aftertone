<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Aftertone

Aftertone is the product, repository (`npHavens/aftertone`) and package name. It was renamed from Discify in October 2026; some local checkouts still live in a folder named `discify`. Tagline: **Your music, rediscovered.**

## Product direction and plans

- Start with [the product/backend plan](docs/plans/aftertone-backend.md) and [the frontend/Figma plan](docs/plans/aftertone-frontend.md).
- Brand direction: **retro and fun**, now with a **blocky 1990s computer font** (user revision September 8). Keep warm cream, burnt orange, mustard, chocolate and tactile controls. The earlier flowing 1970s lettering is a historical exploration. See [the design brief](docs/design/aftertone-brand.md).
- **Local-only development. No deployment, publishing, or cloud provisioning.** Implement and test locally; external provider calls require configured credentials. Do not change existing GCP resources.
- First release: connect Spotify or Apple Music, upload album photos, review/correct matches, create a real playlist. AI-generated playlists are a **future feature**; do not build them or show a working generation control in v1.
- Use format-neutral names for new concepts (`ScanItem`, `PlaylistDraft`, `RecognitionResult`), rather than adding more CD-specific types.
- July/August Discify documents under `docs/superpowers/` are historical. The September Aftertone plans supersede their conflicting model, cookie, branding, and provider API assumptions. The new architecture is a proposal until implemented.

## Current repository

- Next.js 16.4.5, React 19.2.4, TypeScript, Tailwind CSS 4, Framer Motion.
- Local frontend plus FastAPI backend under `backend/`. The active page uses `useSession`, `useScanner`, `usePublishOperation` and `lib/api.ts`; old `lib/mock-recognition.ts` / `hooks/usePlaylist.ts` remain historical prototype code and are not the live integration path. Provider adapters require configured credentials and live acceptance testing.
- Shared types: `types/index.ts`; root alias: `@/*`. CSS theme: `app/globals.css`; no Tailwind JS config.
- Preserve the live-state getter/ref used by the scanner queue. Preserve object-URL cleanup on removal/reset and add cleanup/cancellation when changing those flows.
- Existing `CLAUDE.md` may contain user edits. Do not overwrite unrelated changes.

## Backend boundaries

- Backend implementation: Python FastAPI locally, Google Gen AI SDK in Vertex mode. Local SQLite replaces the future hosted store/queue proposal. Do not introduce an agent framework for the deterministic recognition pipeline. Cloud Run is future architecture, not currently authorized work.
- GCP project: `nhs-aftertone` under No Hands Stack (account `nick@nohandstack.com`), replacing `interview-assistant-507123` on October 25, 2026. Set `GOOGLE_CLOUD_QUOTA_PROJECT=nhs-aftertone`, because the machine-wide ADC quota project belongs to another project. Verify project ownership, billing, model access, and region before provisioning or calls. Do not modify other projects' GCP resources.
- Use the newest flagship Gemini model Nick chooses: currently `gemini-4-argon` on the `global` endpoint, Google's frontier tier. Configure the exact model ID and location (there is no default), verify availability, and use ADC locally / an attached service account in production. Never silently substitute a cheaper tier or route through another AI vendor. Gemini 3+ models manage their own sampling: do not set temperature, top-p or top-k, and use `thinking_level` rather than `thinking_budget`.
- Spotify OAuth and Apple Music MusicKit authorization are different. A Music User Token is not a Sign in with Apple identity token.
- Keep provider tokens server-side, encrypted, behind an opaque HttpOnly session cookie. A signed token container is not encrypted. Never expose secrets via `NEXT_PUBLIC_*`, localStorage, logs, or committed files.
- Gemini proposes album identity; the selected provider supplies canonical track IDs, metadata, and availability. Do not ingest Spotify API content into AI models. Keep provider catalogs and credentials isolated.
- Publishing must handle idempotency, partial completion, and ambiguous upstream failures without blindly creating duplicate playlists or replaying append requests.
- Secrets belong in Secret Manager / local ignored configuration. Record required names, never actual secret values, in examples.

## Design and delivery

- Figma concepts: https://www.figma.com/design/O2weSd1TRdfIJCylcXvlax
- Match approved Figma tokens and components; preserve readable body text, visible focus, keyboard operation, adequate contrast, and reduced-motion behavior.
- The generated logo in `public/brand/aftertone-logo-concept.png` is a raster concept. Plan vector/monochrome/favicon versions before final brand release.
- Provider logos must retain their official treatment; do not distort them to match the retro wordmark.
- Keep design examples clearly separate from real catalog results. Never fall back silently to random albums or simulated publish success in production.

## Verification

- Available scripts: `npm run dev`, `npm run build`, `npm run start`, `npm run typecheck`, `npm test` (Node 24 gateway and selection/recovery tests), `npm run test:browser` (requires the local frontend).
- Run `npm run check` for ESLint, Prettier, TypeScript and gateway tests; `npm run check:backend` for Ruff and pytest. Fix findings before adding more features. VS Code uses format-on-save plus ESLint/Ruff safe fixes.
- CI (`.github/workflows/checks.yml`) runs those checks, the build and the browser tests on pull requests and pushes to `main`. Keep it free of secrets and live services, and pin actions to full commit SHAs.
- Merge gate, before asking Nick to merge:
  1. CI passes.
  2. Codex has reviewed the final head commit; if it doesn't start on its own, comment `@codex review`. It is clean, or each finding is fixed or answered on its thread.
  3. The GitHub Claude review has run on the final head commit, and each finding is fixed or answered. It runs automatically only when a PR is opened or marked ready. After any later push, post a PR comment that starts with `@claude review`, from an owner, member or collaborator account such as Nick's `gh` login. Comments from GitHub App bots or `GITHUB_TOKEN` don't start a review. Wait for the summary comment; if none appears, check the run in the Actions tab. A PR that changes `.github/workflows/claude-review.yml` chooses its own automatic reviewer, so it also needs an `@claude review` run, which uses `main`'s caller. Any change to the caller, not only a pin move, also needs a successful live run of the PR's own caller on the final head: convert the PR to draft, then mark it ready for review.
  4. When asking Nick to merge, report the CI, Codex and Claude results and how each finding was handled. Nick merges; agents never merge. A local `/code-review high` is optional.
- `.github/workflows/claude-review.yml` is a small caller for commercial-breaker's shared `claude-review-reusable.yml`, passing the `CLAUDE_CODE_OAUTH_TOKEN` secret. The reusable workflow runs `/code-review high` on GitHub. It replaces the PR's `AGENTS.md`, `CLAUDE.md`, `CLAUDE.local.md` and `CODE_REVIEW.md` files with `main`'s copies, so a PR's edits to them don't affect its own review. Keep the `uses:` pin a full commit SHA, never a branch or tag. Change the review job in commercial-breaker, then move the pin here in its own PR. GitHub resolves a SHA from anywhere in a repository's fork network, so check that the new SHA is on commercial-breaker's `main`: `gh api repos/npHavens/commercial-breaker/compare/<sha>...main --jq .status` must print `identical` or `ahead`. Runs from opening a PR or marking it ready use the PR's caller, so a PR that moves the pin is reviewed by the new pin. An `@claude review` comment always runs the caller on `main`.
- Keep code simple: descriptive names, short cohesive functions and components, early returns, readable multiline control flow. Avoid compressed one-line implementations, speculative abstractions and blanket lint-rule disables.
- Report frontend gateway tests, backend tests, browser checks and live-provider checks separately.
- For implementation, add focused tests for auth/session boundaries, recognition validation, cancellation, provider failures, and duplicate prevention. Add browser coverage of both complete provider flows.
- Documentation-only changes need link/consistency checks, not an application build. Report exactly what was verified and any live integrations not exercised.

## Code Review Rules

### Review standard

- Review this as a codebase that will be handed to a team, not a personal script repo. Missing tests for changed behavior, misleading comments, duplicated logic, dead code and speculative abstractions are findings, not nits.
- Report every finding you can tie to a concrete trigger and consequence; don't stop at the worst one.
- Leave formatting and lint to tooling.

### Playlist publishing

- Flag any change that could create a duplicate playlist, add the same tracks twice, or report a success the music service did not confirm. Users cannot easily undo a stray playlist in their library.
- Safe path: record the publish before the first provider write. Reusing an idempotency key returns the same operation, and a changed payload under that key is rejected. After a timeout, dropped connection or partial write the outcome is unknown, so show it as needing attention and never retry or replay it automatically. Only a definite rejection before any write succeeded unlocks the draft. Rate limits and outages surface to the user as retryable; no automatic retry loops.

### Credentials and secrets

- This repository is public. Flag any path that exposes a provider token, the Apple signing key, the session encryption key or a `.env` value: committed to git (including fixtures and docs), returned to the browser, placed in `NEXT_PUBLIC_*` variables or browser storage, written to logs or error messages, or stored unencrypted. The browser holds only an opaque HttpOnly session cookie.
- Exception: MusicKit's short-lived developer token, and the one-time handoff of the Music User Token through the CSRF-protected connect request, are part of the MusicKit design. Example files record variable names, never real values.

### Recognition is a proposal

- Flag any path that puts a model's guess into a playlist before the user confirms the match, or that replaces failed or unconfigured recognition with demo, random or cached albums. Also flag a default model or a silent fallback to a cheaper tier or another AI vendor.
- Gemini sees only the user's photo. Flag sending Spotify or Apple Music catalog data into a prompt; Spotify's developer policy forbids feeding its content to AI models.
- Safe path: an unrecognized or unconfigured photo goes to manual catalog search.

### v1 scope

- Flag any working control, endpoint or background job for AI-generated or prompt-described playlists. It is a future feature; v1 is album photos to confirmed matches to a playlist. Copy that describes it as coming later is fine.
