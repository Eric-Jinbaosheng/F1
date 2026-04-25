# F1-Sense — Claude Code Memory

> 24h 黑客松 · HTML5 离线 F1 体感赛车 · 抖音互动空间

## Source of Truth
所有需求看 spec.md(用户对话提供)。本文件只是快速 reference。

## Hard Constraints
1. ZIP ≤ 8MB,完全离线
2. 禁 fetch/XHR/WebSocket/CDN/外链跳转
3. 横屏,竖屏显示蒙版
4. 所有异步 try-catch,catch 不 throw
5. localStorage key 前缀 f1s_
6. ES2022 modules,单引号无分号

## Tech Stack
Vite 5 + TS + Three.js r170 + ZzFX + face-api(可选) + qr-code-styling

## Workflow
- 改代码必 npm run build 验证 size
- 新依赖必先问用户 + 计 size 预算
- 不写测试,浏览器手测
- 文件 > 300 行主动建议拆

## Commands
- npm run dev — 开发
- npm run build — 构建单文件
- npm run size — 检查体积

## File Layout
见 spec.md §4
