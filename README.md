# kakao-agent

KakaoTalk macOS MCP server — LOCO tablet-slot collection, summarize/search/cross-room queries with source attribution. TypeScript/Node OSS.

## Status

This repository currently contains the v0.1 MCP server skeleton plus a local SQLite-backed read-only query layer. Live Kakao auth and ingestion are still follow-up work, but MCP hosts can call the tools against `~/.kakao-agent/messages.db`.

## Requirements

- Node.js 20 LTS or newer
- npm 10 or newer

## Install

After the package is published:

```bash
npm install -g kakao-agent
```

Until then, run from a local checkout:

```bash
git clone https://github.com/HSUNEH/kakao-agent.git
cd kakao-agent
npm install
npm run build
```

## MCP registration

All hosts should start the same stdio server. Published-package examples use:

```text
command: npx
args: ["kakao-agent"]
```

Local checkout examples can use:

```text
command: node
args: ["/absolute/path/to/kakao-agent/dist/mcp-server.js"]
```

### Hermes

Add a server entry to your Hermes MCP configuration. If your Hermes config supports TOML, use:

```toml
[mcp_servers.kakao-agent]
command = "npx"
args = ["kakao-agent"]
```

For local development before npm publish:

```toml
[mcp_servers.kakao-agent]
command = "node"
args = ["/Users/hwang/kakao-agent/dist/mcp-server.js"]
```

Smoke prompt:

```text
Use kakao-agent to list available MCP tools, then call search_messages with query "테스트".
An empty result is OK before rooms are whitelisted and messages are collected or seeded.
```

### Claude Code

Register the server with Claude Code:

```bash
claude mcp add kakao-agent npx kakao-agent
```

For local development before npm publish:

```bash
claude mcp add kakao-agent node /Users/hwang/kakao-agent/dist/mcp-server.js
```

Smoke prompt:

```text
Use kakao-agent to search my whitelisted KakaoTalk rooms for "테스트" and show speaker, room, timestamp, and message.
If it returns an empty result, report that the MCP roundtrip succeeded and no local whitelisted messages matched yet.
```

### Codex

Add the MCP server to Codex's MCP configuration:

```toml
[mcp_servers.kakao-agent]
command = "npx"
args = ["kakao-agent"]
```

For a local checkout:

```toml
[mcp_servers.kakao-agent]
command = "node"
args = ["/Users/hwang/kakao-agent/dist/mcp-server.js"]
```

Smoke prompt:

```text
Call kakao-agent.search_messages with query "테스트". Confirm whether the MCP server spawned, listed tools, and returned a tool response.
```

### OpenClaw / agentskills.io

OpenClaw-compatible hosts can load the repository `manifest.yaml` as an agentskills.io-style MCP manifest. The manifest advertises the stdio runtime, `npx kakao-agent` entrypoint, and the three MCP tools.

```bash
npm run build
cat manifest.yaml
```

Smoke prompt:

```text
Load kakao-agent from its agentskills.io manifest, list tools, then call search_messages with query "테스트".
```

## MCP tools

- `summarize_room(roomId, periodFrom, periodTo)` — returns room messages for host-side summarization.
- `search_messages(query)` — searches collected messages.
- `cross_room_query(query, periodFrom?, periodTo?)` — queries across whitelisted rooms.

Current behavior: each tool is registered and callable. Search tools query the local SQLite message DB and only return messages from rooms listed in `~/.kakao-agent/whitelist.yaml`. Live Kakao ingestion/auth is still implemented in later issues.

## Local DB search setup

`kakao-agent` is read-only. It searches `~/.kakao-agent/messages.db` and only returns rows whose `chatroomId` is listed in `~/.kakao-agent/whitelist.yaml`. Missing config files are created with privacy-safe empty defaults on first tool call.

Minimal whitelist example:

```yaml
chatroomIds:
  - 123456789
```

The local SQLite table is created automatically if missing. Ingestion is still a follow-up task, but seeded or collected rows should use the `messages` table columns from the KakaoMessage ontology: `logId`, `chatroomId`, `roomDisplayName`, `senderId`, `senderName`, `messageType`, `content`, `mediaMeta`, `replyTargetLogId`, `systemEventType`, `timestamp`, `isDeleted`, and `collectedAt`.

## Development

```bash
npm install
npm run build
npm run lint
npm run format:check
```

Run the stdio MCP server locally:

```bash
node dist/mcp-server.js
```

Global package entrypoint after install/publish:

```bash
npx kakao-agent
```

## Smoke test

The repository includes a manual MCP smoke test that performs initialize → list tools → call `search_messages`:

```bash
npm run smoke:mcp
```

The default smoke test starts `node dist/mcp-server.js`. To test another command, pass JSON args through environment variables:

```bash
KAKAO_AGENT_MCP_COMMAND=npx KAKAO_AGENT_MCP_ARGS='["kakao-agent"]' node scripts/smoke-mcp.mjs
```

A successful smoke test prints JSON with `ok: true`, all three tool names, and a `toolCall.responseKind`. With an empty default whitelist, the call returns a valid empty result. To verify real local DB querying and whitelist enforcement, run `npm run smoke:search`.

## Troubleshooting

- **`npx kakao-agent` fails** — the package may not be published yet. Use the local checkout command (`node /absolute/path/to/dist/mcp-server.js`) after `npm run build`.
- **Node version errors** — install Node.js 20 LTS or newer.
- **No live Kakao auth** — live LOCO auth is not implemented in the bootstrap skeleton. Auth-related commands and real message reads land in later issues.
- **Empty whitelist or no collected messages** — v0.1 is privacy-first: collection/search should return nothing until rooms are explicitly whitelisted and ingestion has run.
- **Search returns `[]`** — this is expected until `~/.kakao-agent/whitelist.yaml` lists room IDs and `~/.kakao-agent/messages.db` contains collected/seeded messages.
- **Live Kakao auth is missing** — live LOCO auth and ingestion are separate follow-up tasks; the MCP query layer is read-only and local-DB backed.
