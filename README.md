# DeepSeek Usage Widget

A floating usage widget for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI. It shows your real DeepSeek API balance and locally-aggregated token usage as a draggable, morphing overlay card.

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![harness](https://img.shields.io/badge/DeepSeek%20Harness-web-blue)](https://github.com/deepseek-ai/deepseek-harness)

## What it does

- **Collapsed** — a compact liquid-glass card with the account status dot and your total balance.
- **Expanded** — a full dashboard: balance, today's tokens & requests, and a 7/30-day cost / token trend chart.
- Click the card to expand · click outside to collapse · drag to move (position persists).

## Features

| Area | Detail |
| --- | --- |
| Balance | Official `GET /user/balance`, resolved from `DEEPSEEK_API_KEY` on the Host. Auto-refreshes every 60 s plus a manual **Refresh** button. |
| Usage | Real `assistant/message` token usage aggregated per day — input / cache hit / cache miss / output / reasoning — plus request count. |
| Cost | `tokens × official per-model price`, labelled `Estimated / local usage`. |
| Security | The API key never leaves the Host — never in the browser, network responses, localStorage, or logs. |
| UX | Spring morph animation, drag + persist, click-outside-to-close, `prefers-reduced-motion`, Dark/Light aware. |

## Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) running the **Web** profile.
- A `DEEPSEEK_API_KEY` configured in **Settings → Models**, or exported in the environment.

## Install

This is a dual-face (Host + browser) plugin designed to live inside the DeepSeek Harness monorepo under `packages/extensions/`.

1. Copy this folder to `packages/extensions/deepseek-usage-widget/`.

2. Add the two tsconfig references:

   - In `tsconfig.host.json` references:
     ```json
     { "path": "./packages/extensions/deepseek-usage-widget/tsconfig.host.json" }
     ```
   - In `tsconfig.client.json` references:
     ```json
     { "path": "./packages/extensions/deepseek-usage-widget/tsconfig.client.json" }
     ```

3. Register the row in `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

   ```yaml
   - insert:
       - id: deepseek-usage-widget
         name: '@deepseek-ai/dsh-deepseek-usage-widget'
   ```

4. Build and restart:

   ```bash
   pnpm install
   npx tsc -b packages/extensions/deepseek-usage-widget/tsconfig.host.json
   npx tsc -b packages/extensions/deepseek-usage-widget/tsconfig.client.json
   npx tsdown --env.DSH_BUILD_FACE client
   # then restart `dsh web`
   ```

## Data sources

| Data | Source | Labelled |
| --- | --- | --- |
| Balance | DeepSeek official API | **Official** |
| Tokens / requests | Harness session `usage` events | **Local (real usage)** |
| Cost | tokens × official price | **Estimated / local** |

> Usage is aggregated from the moment the plugin is installed; historical sessions are not back-filled.

## Architecture

```
Host (Node)                                 Browser
├── credentials → DEEPSEEK_API_KEY           ├── shell.overlay entry
├── GET /user/balance (60 s + manual)        │   ├── CollapsedCard
├── session/event → daily usage fold         │   └── ExpandedPanel
├── storage domain (position + daily cache)  │       ├── balance / KPIs
└── /deepseek-usage/{snapshot,position,refresh}   └── trend chart
```

## License

[MIT](LICENSE)
