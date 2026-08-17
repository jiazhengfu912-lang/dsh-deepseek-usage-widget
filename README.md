# DeepSeek Usage Widget

A floating usage widget for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. It shows your real DeepSeek API balance and locally-aggregated token usage as a draggable, morphing overlay card.

![status](https://img.shields.io/badge/status-beta-blue) ![license](https://img.shields.io/badge/license-MIT-green)

## Features

- **Official balance** — reads `GET https://api.deepseek.com/user/balance` using your `DEEPSEEK_API_KEY`. The key is resolved **on the Host** and never reaches the browser, network responses, localStorage, or logs.
- **Local token usage** — aggregates real `assistant/message` token usage (`input` / `cache hit` / `cache miss` / `output` / `reasoning`) and request counts, bucketed per day.
- **Estimated cost** — real tokens × official per-model price, clearly labelled `Estimated / local usage` (never presented as the official settlement amount).
- **Trend chart** — 7-day / 30-day toggle, Cost ⇄ Tokens toggle.
- **Drag & persist** — move the card anywhere; the position persists and self-clamps into the viewport.
- **Morph animation** — the collapsed card expands into a full dashboard with a spring transition; click outside to collapse (no Close button).
- **Dark / Light aware** — uses the Harness design tokens.

## Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) running the **Web** profile.
- A `DEEPSEEK_API_KEY` configured in **Settings → Models**, or exported as an environment variable.

## Download

```bash
git clone https://github.com/<your-account>/dsh-deepseek-usage-widget.git
```

## Install

This package is a dual-face plugin designed to live inside the DeepSeek Harness monorepo under `packages/extensions/`.

1. Copy this folder into `packages/extensions/deepseek-usage-widget/`.
2. Add the tsconfig references (below).
3. Register the row in your profile's patch file (below).
4. Build and restart.

### tsconfig references

In `tsconfig.host.json` references:

```json
{ "path": "./packages/extensions/deepseek-usage-widget/tsconfig.host.json" }
```

In `tsconfig.client.json` references:

```json
{ "path": "./packages/extensions/deepseek-usage-widget/tsconfig.client.json" }
```

### Profile registration

In `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: deepseek-usage-widget
      name: '@deepseek-ai/dsh-deepseek-usage-widget'
```

### Build

```bash
pnpm install
npx tsc -b packages/extensions/deepseek-usage-widget/tsconfig.host.json
npx tsc -b packages/extensions/deepseek-usage-widget/tsconfig.client.json
npx tsdown --env.DSH_BUILD_FACE client
```

Then restart `dsh web`.

## Data sources

| Data | Source | Label |
| --- | --- | --- |
| Balance | DeepSeek official API `/user/balance` | **Official** |
| Token usage | Harness session `assistant/message` `usage` events | **Local (real usage)** |
| Cost | tokens × official per-model price | **Estimated / local** |

Usage is aggregated incrementally from the moment the plugin is installed; historical sessions are not back-filled. Balance refreshes every 60 seconds.

## Architecture

```
Host (Node)                                Client (browser)
├── credentials.resolve(DEEPSEEK_API_KEY)  ├── shell.overlay entry
├── GET /user/balance (60s)                │   ├── CollapsedCard
├── session/event → daily usage fold       │   └── ExpandedPanel
├── storage domain persistence             │       ├── metrics
└── HTTP routes /deepseek-usage/*          │       └── trend chart
```

## License

[MIT](LICENSE)
