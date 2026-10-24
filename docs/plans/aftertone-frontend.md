# Aftertone — frontend and Figma plan

Date: September 7, 2026. Status: planning and concept design; application remains the Discify prototype.

## September 8 implementation scope

Frontend/backend implementation is now authorized in parallel, **local only, no deployment**. Retain the warm retro palette but replace the flowing display style with blocky 1990s computer typography. Expand Figma concepts while implementing connection/setup, upload, review/correction and publish/result flows against the local FastAPI contract. Preserve prior artwork as historical exploration. Credential-free startup must show useful setup states, not fabricated successful integrations.

See [brand direction](../design/aftertone-brand.md) and [backend contracts](aftertone-backend.md). The user selected **Aftertone**, a cool retro logo and a retro/fun theme. The earlier dark Setwoven concept is superseded.

## Design deliverables

[Figma concept file](https://www.figma.com/design/O2weSd1TRdfIJCylcXvlax) contains the evolving brand direction and key desktop/mobile concepts. Concepts illustrate layout and style; they are not a complete production component system or a fully wired prototype. The logo raster is saved in `public/brand/aftertone-logo-concept.png`.

Complete Figma handoff before visual implementation: semantic color/spacing variables; display/body styles; button, service connection, scan card, track row, alert, dialog and summary components with variants; desktop 1440/1024 and mobile 390/320 layouts; node links attached to implementation tasks. Use auto-layout and instances. Keep realistic long titles, counts and error content in examples. Placeholder sample text must never become a production catalog fallback.

## Information architecture

| View                | Main action                                         | Essential states                                                                   |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Welcome / connect   | Connect Spotify or Apple Music                      | Connecting, consent denied, popup blocked, unavailable account, return from OAuth  |
| Add photos          | Camera/file picker or drop zone                     | Empty, dragging, invalid/oversized file, upload, processing, cancellation          |
| Review              | Correct album matches, inspect tracks, choose order | Matched, needs review, not found, duplicate, removed item, long tracklist          |
| Playlist summary    | Edit name, review target and counts, publish        | Empty selection, unresolved items, valid, creating, connection expired             |
| Result              | Open playlist in selected service                   | Complete, skipped tracks, partial, uncertain write, retry/reconnect                |
| Connection settings | Disconnect or switch service                        | Confirmation when selected provider data will be cleared; draft input preservation |

V1 sequence: **Connect → Add photos → Review → Create → Open in your music service.** No fake AI prompt box. Photos are album identity inputs; wider naming does not imply arbitrary scene recognition or shelf segmentation.

## Layout and interaction

Desktop uses an expressive headline, cream paper canvas, album review area and a sticky playlist summary. Review cards have framed artwork, clear artist/title, source link, editable match and status label. Mobile stacks the workflow with a sticky summary/action that respects safe areas and never covers the last result. Use a normal button as an accessible alternative to drag/drop and camera capture.

Show the active service and storefront/market where useful. Spotify and Apple connection actions get equal prominence, but preserve official branding. MusicKit's user gesture and loading requirements drive the Apple button behavior. The callback restores the intended screen without redirect loops.

Review remains editable until publishing starts. The publisher operates on a frozen draft revision. Disable repeat submission, announce progress without inventing percentage completion, and only celebrate a confirmed successful outcome. Reconnection keeps user inputs but revalidates provider data. Switching service re-resolves photos and invalidates prior provider selections.

## Code plan

| Step                        | Files / work                                                                                               | Acceptance                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| F0 Design completion        | Figma system, logo variants, missing error/result frames                                                   | Review desktop/mobile and keyboard flow; name/theme consistently Aftertone                                                   |
| F1 Theme and shell          | `app/globals.css`, `app/layout.tsx`, `components/layout/Header.tsx`, brand assets, `README.md`             | Cream/orange retro theme, readable typography, responsive header and correct metadata; preserve package/infrastructure names |
| F2 Contracts and connection | `types/index.ts`, `lib/api.ts`, new `components/auth/`, `hooks/useSession.ts`                              | Session loading/reconnect/disconnect; Spotify callback and actual MusicKit gesture flow; no tokens in client storage         |
| F3 Real scanning            | `lib/image.ts`, `hooks/useCDScanner.ts` → format-neutral scanner when migrated, upload/scanning components | Validation messages, bounded queue, cancellation, no stale resurrection after reset/remove/switch                            |
| F4 Review and correction    | Album components, new album search dialog, playlist draft hook                                             | Provider-backed correction and links; accessible selection/reorder controls; optional metadata handled                       |
| F5 Publishing/results       | Playlist components, operation polling hook, result modal/page                                             | Stable idempotency key per frozen revision; resume status after temporary network loss; accurate partial/unknown outcomes    |
| F6 Verification             | Configure focused component and Playwright coverage                                                        | Full Spotify and Apple journeys; keyboard, 320px layout, reduced motion, slow network, expired auth, partial publish         |

Read the installed Next.js guides before changing application code: server/client components, Route Handlers or rewrites for the chosen gateway, cookies, fonts, and Script for MusicKit. Do not recreate the whole app to change the visual theme. Retain useful state/ref and object-URL lifecycle behavior while replacing the mocks.

Proposed component variants: Button (primary/secondary/destructive, idle/busy/disabled/focus); ServiceConnection (disconnected/connecting/connected/expired); ScanCard (queued/processing/matched/review/error); PublishSummary (editing/submitting/partial/complete); Alert (info/action-required/error). Use a real label rather than a color-only confidence badge; user correction is not model certainty.

## Definition of ready for implementation

Design review has selected the final logo treatment and key screens. Backend B0 establishes real account capabilities and gateway origin. DTOs and error semantics are agreed. Required credentials are configured securely. Backend and FE milestones can then progress together against explicit contracts.

## Definition of done for v1

Both provider accounts complete authorization, photo recognition, correction, playlist creation and open-in-service using real data. Error/retry flows preserve user work without duplicate publishing. No secrets leak into browser storage/logs, no mock success remains, and the retro design works on desktop/mobile with keyboard and reduced motion. Tests and real account checks are reported separately. Public availability remains subject to provider access and review.

## Future extension

Add a second creation route for AI-generated playlists later. It produces the same `PlaylistDraft` and reuses review/publish. Add prompt refinement and generation states only in that release; the current IA reserves room without shipping a dead navigation tab. Persistent app accounts, linked provider identities, history and cross-device drafts require their own identity/data design.
