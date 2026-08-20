# DeepSeek Usage Widget

[English](README.md) | 中文

一个用于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI 的悬浮用量组件。它以可拖动、可展开的叠加卡片显示真实的 DeepSeek API 余额和本地聚合的 Token 用量。

[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![harness](https://img.shields.io/badge/DeepSeek%20Harness-web-blue)](https://github.com/deepseek-ai/deepseek-harness)

## 功能概览

- **收起状态**——紧凑的液态玻璃卡片，显示账号状态点和总余额。
- **展开状态**——完整仪表板，显示余额、今日 Token 数和请求数，以及 7/30 天费用或 Token 趋势图。
- 点击卡片展开，点击外部收起；拖动可调整位置，位置会持久保存。

## 功能

| 领域 | 说明 |
| --- | --- |
| 余额 | 由 Host 使用 `DEEPSEEK_API_KEY` 调用官方 `GET /user/balance`。每 60 秒自动刷新，也可使用 **Refresh** 按钮手动刷新。 |
| 用量 | 按天聚合真实的 `assistant/message` Token 用量，包括输入、缓存命中、缓存未命中、输出和推理 Token，并统计请求次数。 |
| 费用 | 按“Token 数 × 官方模型价格”计算，并标记为 `Estimated / local usage`（估算/本地用量）。 |
| 安全性 | API Key 始终保留在 Host 中，不会进入浏览器、网络响应、`localStorage` 或日志。 |
| 体验 | 支持弹簧形变动画、拖动和位置持久化、点击外部关闭、`prefers-reduced-motion` 以及深色/浅色主题。 |

## 要求

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 以 **Web** profile 运行。
- 已在 **Settings → Models** 中配置 `DEEPSEEK_API_KEY`，或通过环境变量导出该值。

## 安装

这是一个同时包含 Host 与浏览器两部分的插件，设计为放置在 DeepSeek Harness monorepo 的 `packages/extensions/` 目录下。

1. 将此文件夹复制到 `packages/extensions/deepseek-usage-widget/`。

2. 添加两个 tsconfig 引用：

   - 在 `tsconfig.host.json` 的 references 中添加：
     ```json
     { "path": "./packages/extensions/deepseek-usage-widget/tsconfig.host.json" }
     ```
   - 在 `tsconfig.client.json` 的 references 中添加：
     ```json
     { "path": "./packages/extensions/deepseek-usage-widget/tsconfig.client.json" }
     ```

3. 在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 中注册：

   ```yaml
   - insert:
       - id: deepseek-usage-widget
         name: '@deepseek-ai/dsh-deepseek-usage-widget'
   ```

4. 构建并重启：

   ```bash
   pnpm install
   npx tsc -b packages/extensions/deepseek-usage-widget/tsconfig.host.json
   npx tsc -b packages/extensions/deepseek-usage-widget/tsconfig.client.json
   npx tsdown --env.DSH_BUILD_FACE client
   # 然后重启 `dsh web`
   ```

## 数据来源

| 数据 | 来源 | 标记 |
| --- | --- | --- |
| 余额 | DeepSeek 官方 API | **Official** |
| Token / 请求 | Harness 会话 `usage` 事件 | **Local (real usage)** |
| 费用 | Token 数 × 官方价格 | **Estimated / local** |

> 用量从插件安装后开始聚合，不会回填历史会话。

## 架构

```text
Host (Node)                                 浏览器
├── credentials → DEEPSEEK_API_KEY           ├── shell.overlay 入口
├── GET /user/balance（60 秒 + 手动）          │   ├── CollapsedCard
├── session/event → 每日用量聚合               │   └── ExpandedPanel
├── storage domain（位置 + 每日缓存）           │       ├── 余额 / KPI
└── /deepseek-usage/{snapshot,position,refresh}   └── 趋势图
```

## 许可证

[MIT](LICENSE)
