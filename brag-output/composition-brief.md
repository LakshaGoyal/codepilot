# Hyperframes Composition Brief: Agent Pager

## Objective
Create a short launch-style brag video for Agent Pager.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: vertical — 1080x1920
- Duration: 25.0 seconds

## Source Material
- Project root: `e:/comet-command`
- Primary files read: `README.md`, `package.json`, `web/src/styles.css`, `web/src/App.jsx`
- Product name: Agent Pager
- Tagline / strongest claim: "Your coding agent, in the group chat. Claude Code + CometChat."
- Key UI or visual moment to recreate:
  - Phone group chat screen with `@Pager` prompt
  - Sliding Agent Console showing live tool execution & test pass badge
  - `agent_result` card with diff, `[ Ship it ]` tap gesture, and `agent_event: shipped a1b2c3d`
- Copy that must appear verbatim:
  - "YOUR CODING AGENT LIVES IN THE GROUP CHAT."
  - "@Pager make the signup button orange"
  - "PASS (7/7 tests passed)"
  - "Updated signup button background to orange (#ff6b4a)"
  - "NO DASHBOARDS. NO TERMINAL BABYSITTING."

## Creative Direction
- Tone preset: cinematic
- Creative direction: Dramatic trailer-scale product film with high-contrast monochrome design, deep atmospheric glows, precision motion, and audio-reactive elements.
- Interpretation: Crisp vertical composition with rich dark glass styling, bold typographic slams, and smooth step transitions.
- Angle: Software development moves out of terminal windows and directly into group chats where teammates review and ship together.
- Hook: Giant bold text slamming onto dark background: "YOUR CODING AGENT LIVES IN THE GROUP CHAT."
- Outro / punchline: "NO DASHBOARDS. NO TERMINAL BABYSITTING." followed by the AGENT PAGER logo badge.
- Avoid: Generic SaaS vectors, abstract non-product visuals, cartoonish animations.

## Visual Identity
- Background: `#000000` (deep black)
- Text: `#ffffff` (primary white), `#9a9a9a` (muted grey)
- Accent: `#ffffff` (monochrome), `#00e676` (test success green), `#ff4444` (diff remove red)
- Display font: `Inter`, system-ui, sans-serif
- Body font: `Inter`, system-ui, sans-serif
- Code font: `ui-monospace`, `SFMono-Regular`, `Consolas`, monospace
- Visual references from the project: Dark glass cards (`rgba(255,255,255,0.035)`), thin borders (`rgba(255,255,255,0.12)`), agent console drawer styling from `web/src/styles.css`.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Cinematic Hook — 4.5s — Title slam: "YOUR CODING AGENT LIVES IN THE GROUP CHAT."
2. The Command — 4.5s — Phone chat view with typed message: "@Pager make the signup button orange"
3. The Brain at Work — 5.5s — Console drawer slides out with 4 live step reveals and test PASS badge
4. Result & One-Tap Approval — 6.0s — Diff result card, cursor tap on "[ Ship it ]", and commit confirmation
5. Outro & Punchline — 4.5s — "NO DASHBOARDS. NO TERMINAL BABYSITTING." → AGENT PAGER logo lockup

## Audio
- Audio role: Cinematic trailer support with sub-bass swells, rhythmic step ticks, and glass tap chime.
- Audio arc: Dark atmospheric intro -> technical pulse during console steps -> victory chime on approval -> heavy logo lockup impact.
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3`
- Music treatment: Starts at 0s, builds momentum, ducks under final logo reveal.
- Music cue guidance: Strong cues at 4.39s (Scene 2 transition), 8.74s (Console reveal), 14.73s (Result card arrival), 20.19s (Outro logo slam). Beat grid for console steps at ~1.1s intervals.
- Audio-reactive treatment: Subtle radial glow behind the main product card reacting to music bass/RMS.
- Audio-coupled moments:
  - Scene 2: Mechanical key sounds as prompt text is typed into chat.
  - Scene 3: Beat-grid UI ticks for each console step arrival.
  - Scene 4: Glass chime on simulated "Ship it" button tap.
  - Scene 5: Sub-bass boom on logo reveal.
- SFX selection guidance: Match UI action to subtle interface/keyboard sound effects from `sfx-analysis.md`.

## Hyperframes Instructions
- Composition dimensions: 1080x1920 (9:16 vertical).
- Total duration: 25.0 seconds.
- Create composition in `brag-output/composition/`.
- Ensure all text passes WCAG contrast checks against dark backgrounds.
- Run `npx hyperframes check` in `brag-output/composition/` before render.
