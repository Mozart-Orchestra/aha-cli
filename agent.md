# better0330 / aha-cli branch agent plan

## 目标
- 在 `better0330` 分支把 CLI 主测试入口升级到 `aha-v9` / `aha-v9-mcp` / `kanban-v9`
- 与根目录 `docker-compose.better0330.yml` + `.env.better0330` 配合，启动一套不冲突的新环境
- 后续用浏览器对 kanban UI 做可视化回归

## 当前基线
- `aha-cli-better0330`: `c69d18a`
- `genome-hub-better0330`: `e9b4d77`
- `happy-server-better0330`: `93d9997`
- `kanban-better0330`: `88b9540`

## 推荐测试顺序
1. `cd aha-cli-better0330 && yarn build`
2. `node ./bin/aha-v9.mjs --version`
3. `docker compose -f ../docker-compose.yml -f ../docker-compose.better0330.yml --env-file ../.env.better0330 --profile cli up -d --build`
4. `GENOME_HUB_PORT=3106 HAPPY_SERVER_PORT=3105 KANBAN_PORT=8082 ../scripts/local-smoke.sh`
5. 浏览器验证 `http://localhost:8082`

## CLI v9 验收点
- 默认 home 目录变为 `~/.aha-v9`
- Docker 容器默认 home 目录变为 `/home/node/.aha-v9`
- 旧 alias (`aha-v3` / `aha-v7`) 不被破坏
- `aha-v9-mcp` 继续保持 fail-fast：缺 URL 时直接报错，不静默 fallback
