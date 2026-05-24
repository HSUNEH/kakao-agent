#!/usr/bin/env node
/* global process, console */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = ['cross_room_query', 'search_messages', 'summarize_room'];
const command = process.env.KAKAO_AGENT_MCP_COMMAND ?? process.execPath;
const args = process.env.KAKAO_AGENT_MCP_ARGS
  ? JSON.parse(process.env.KAKAO_AGENT_MCP_ARGS)
  : ['dist/cli.js'];

if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string')) {
  throw new TypeError('KAKAO_AGENT_MCP_ARGS must be a JSON array of strings.');
}

const transport = new StdioClientTransport({ command, args });
const client = new Client({ name: 'kakao-agent-smoke', version: '0.1.0' });

try {
  await client.connect(transport);

  const listToolsResult = await client.listTools();
  const toolNames = listToolsResult.tools.map((tool) => tool.name).sort();
  const missingTools = expectedTools.filter((toolName) => !toolNames.includes(toolName));

  if (missingTools.length > 0) {
    throw new Error(`Missing expected MCP tools: ${missingTools.join(', ')}`);
  }

  const callResult = await client.callTool({
    name: 'search_messages',
    arguments: { query: '테스트' }
  });

  const responseText = callResult.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('\n');

  if (responseText.length === 0 && callResult.content.length === 0) {
    throw new Error('Tool call returned no MCP content.');
  }

  const responseKind = callResult.isError
    ? responseText.includes('registered but not implemented yet')
      ? 'placeholder-error'
      : 'error-response'
    : 'success-response';

  console.log(
    JSON.stringify(
      {
        ok: true,
        command,
        args,
        toolNames,
        toolCall: {
          tool: 'search_messages',
          responseKind,
          isError: callResult.isError ?? false,
          text: responseText
        }
      },
      null,
      2
    )
  );
} finally {
  await client.close();
}
