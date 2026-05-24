# kakao-agent

KakaoTalk macOS MCP server — LOCO tablet-slot collection, summarize/search/cross-room queries with source attribution. TypeScript/Node OSS.

## Status

This repository currently contains the v0.1 MCP bootstrap skeleton. The stdio server exposes the planned tool surface and returns explicit placeholder errors until the ingestion and query tasks are implemented.

## Requirements

- Node.js 20 LTS or newer
- npm 10 or newer

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

## MCP tools

- `summarize_room(roomId, periodFrom, periodTo)`
- `search_messages(query)`
- `cross_room_query(query, periodFrom?, periodTo?)`
