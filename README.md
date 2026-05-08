# 团队项目进度后台

面向内网部署的项目需求进度同步后台。第一版以项目为入口，支持需求/任务表、看板、成员账号、进度时间线、CSV/xlsx 导入导出。

## 本地运行

```bash
npm install
npm run dev
```

首次访问会进入初始化页，创建管理员账号后即可使用。

## 智能导入

- `RIGHT_CODE_GPT_API_KEY`: Right Code 令牌，服务端优先读取这个环境变量。
- `RIGHT_CODE_GPT_BASE_URL`: 默认 `https://www.right.codes/codex/v1`。
- `RIGHT_CODE_GPT_MODEL`: 默认 `gpt-5.2`。
- `RIGHT_CODE_GPT_TIMEOUT_MS`: 默认 `20000`。
- 也可以在页面的 AI 自动导入表单里临时填写 Right Code 令牌，只用于本次上传，不会落库。

## 验证

```bash
npm run lint
npm test
npm run build
```
