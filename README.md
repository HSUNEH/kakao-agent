# kakao-agent

KakaoTalk macOS MCP server — LOCO tablet-slot collection, summarize/search/cross-room queries with source attribution. TypeScript/Node OSS.

## Status

This repository currently contains the v0.1 MCP bootstrap skeleton. The stdio server exposes the planned tool surface and returns explicit placeholder errors until the ingestion and query tasks are implemented.

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
It is OK if the current bootstrap build returns a registered-but-not-implemented placeholder error.
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
If the tool reports that it is registered but not implemented yet, report that the MCP roundtrip succeeded.
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

Current bootstrap behavior: each tool is registered and callable, but returns a placeholder error until ingestion/search issues are implemented.

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

A successful smoke test prints JSON with `ok: true`, all three tool names, and a `toolCall.responseKind`. The current bootstrap build reports `placeholder-error`; later real search implementations may report `success-response`.

## Troubleshooting

- **`npx kakao-agent` fails** — the package may not be published yet. Use the local checkout command (`node /absolute/path/to/dist/mcp-server.js`) after `npm run build`.
- **Node version errors** — install Node.js 20 LTS or newer.
- **No live Kakao auth** — live LOCO auth is not implemented in the bootstrap skeleton. Auth-related commands and real message reads land in later issues.
- **Empty whitelist or no collected messages** — v0.1 is privacy-first: collection/search should return nothing until rooms are explicitly whitelisted and ingestion has run.
- **Tool returns “registered but not implemented yet”** — this is the expected bootstrap response. It means spawn, list-tools, and tool-call roundtrip are working.
