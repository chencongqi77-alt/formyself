# 诗行漫记

这是古诗词知识地图项目的代码仓库，包含：

- `web/`：基于 Next.js/Vinext 的网站、阅读模块和测试；
- `scripts/`：书籍上传、事实校验和发布流程脚本；
- `data/contracts/`：数据契约与 JSON Schema；
- `docs/`：系统设计、工作流和论文交接资料。

## 本地运行网站

需要 Node.js `>=22.13.0`：

```powershell
cd web
npm install
npm run dev
```

校验命令：

```powershell
npm run lint
npm run build
npm test
```

## 数据边界

仓库保留用于网站演示的公开静态数据和发布数据，但不包含原始资料层、CBDB
数据库、完整 `chinese-poetry` 快照、用户上传文件、模型输出或本地运行时缓存。
这些内容留在本地环境中，相关脚本会在缺少资料层时跳过需要原始快照的校验。

API 密钥只应放在本地 `.env` 或 `web/.dev.vars`，不要提交到 Git。
