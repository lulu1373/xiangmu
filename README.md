# 团队项目进度后台

面向内网部署的项目需求进度同步后台。第一版以项目为入口，支持需求/任务表、看板、成员账号、进度时间线、CSV/xlsx 导入导出。

## 本地运行

```bash
npm install
TEAM_PROGRESS_DATABASE_URL=mysql://user:password@127.0.0.1:3306/team_progress_admin
npm run dev
```

首次访问会进入初始化页，创建管理员账号后即可使用。
如果已经初始化完成，直接访问 `http://localhost:3001/projects`。

## 数据库

项目运行时已强制使用 MySQL：

```bash
TEAM_PROGRESS_DATABASE_URL=mysql://user:password@127.0.0.1:3306/team_progress_admin
```

也支持拆开的 MySQL 环境变量：

```bash
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=team_progress_admin
```

应用启动后会自动建表。

## SQLite 迁移到 MySQL

如果你之前已经在 SQLite 里录入了项目和进度，先让应用在 MySQL 环境下启动一次建表，再执行：

```bash
npm run migrate:sqlite-to-mysql -- ./data/team-progress.sqlite
```

也可以用环境变量指定源文件：

```bash
SOURCE_SQLITE_PATH=./data/team-progress.sqlite npm run migrate:sqlite-to-mysql
```

## Docker 部署

这个项目已经补了 `Dockerfile`，同事可以直接在项目根目录构建镜像：

```bash
docker build -t team-progress-admin:latest .
```

运行时至少要传 MySQL 连接：

```bash
docker run -d \
  --name team-progress-admin \
  -p 3001:3001 \
  -e TEAM_PROGRESS_DATABASE_URL='mysql://root:password@120.77.254.76:3306/project_management' \
  team-progress-admin:latest
```

如果要启用 AI 自动导入，再补这些环境变量：

```bash
-e RIGHT_CODE_GPT_API_KEY='your_token' \
-e RIGHT_CODE_GPT_BASE_URL='https://www.right.codes/codex/v1' \
-e RIGHT_CODE_GPT_MODEL='gpt-5.2'
```

容器启动后默认监听 `3001` 端口。
浏览器入口是 `http://服务器IP:3001/projects`。

## 智能导入

- `RIGHT_CODE_GPT_API_KEY`: Right Code 令牌，服务端优先读取这个环境变量。
- `RIGHT_CODE_GPT_BASE_URL`: 默认 `https://www.right.codes/codex/v1`。
- `RIGHT_CODE_GPT_MODEL`: 默认 `gpt-5.2`。
- `RIGHT_CODE_GPT_TIMEOUT_MS`: 默认 `20000`。
- 也可以在页面的 AI 自动导入表单里临时填写 Right Code 令牌，只用于本次上传，不会落库。

## 验证

```bash
npm run lint
TEAM_PROGRESS_TEST_DATABASE_URL=mysql://user:password@127.0.0.1:3306/team_progress_test npm test
npm run build
```
