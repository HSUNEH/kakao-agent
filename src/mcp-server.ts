#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  {
    name: 'kakao-agent',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

const tools: Tool[] = [
  {
    name: 'summarize_room',
    description:
      'Return KakaoTalk messages from one chat room in logId order for a host LLM to summarize.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['roomId', 'periodFrom', 'periodTo'],
      properties: {
        roomId: {
          type: 'number',
          description: 'KakaoTalk chatroomId to read from.'
        },
        periodFrom: {
          type: 'number',
          description: 'Inclusive start time as Unix epoch milliseconds.'
        },
        periodTo: {
          type: 'number',
          description: 'Inclusive end time as Unix epoch milliseconds.'
        }
      }
    }
  },
  {
    name: 'search_messages',
    description: 'Search collected KakaoTalk messages by free-text query.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'Text to search for in collected message content.'
        }
      }
    }
  },
  {
    name: 'cross_room_query',
    description:
      'Return candidate KakaoTalk messages across whitelisted rooms for downstream AI analysis.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          minLength: 1,
          description: 'Natural-language query or keyword to match across rooms.'
        },
        periodFrom: {
          type: 'number',
          description: 'Optional inclusive start time as Unix epoch milliseconds.'
        },
        periodTo: {
          type: 'number',
          description: 'Optional inclusive end time as Unix epoch milliseconds.'
        }
      }
    }
  }
];

server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, (request: CallToolRequest) => {
  const toolName = request.params.name;
  const knownTool = tools.find((tool) => tool.name === toolName);

  if (!knownTool) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Unknown tool: ${toolName}`
        }
      ]
    };
  }

  return {
    isError: true,
    content: [
      {
        type: 'text',
        text:
          `${toolName} is registered but not implemented yet. ` +
          'This bootstrap build only exposes the MCP tool surface.'
      }
    ]
  };
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`kakao-agent MCP server failed: ${message}`);
  process.exitCode = 1;
});
