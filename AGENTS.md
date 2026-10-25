<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
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

- Next.js 16.2.6, React 19.2.4, TypeScript, Tailwind CSS 4, Framer Motion.
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
- Keep code simple: descriptive names, short cohesive functions and components, early returns, readable multiline control flow. Avoid compressed one-line implementations, speculative abstractions and blanket lint-rule disables.
- Report frontend gateway tests, backend tests, browser checks and live-provider checks separately.
- For implementation, add focused tests for auth/session boundaries, recognition validation, cancellation, provider failures, and duplicate prevention. Add browser coverage of both complete provider flows.
- Documentation-only changes need link/consistency checks, not an application build. Report exactly what was verified and any live integrations not exercised.
