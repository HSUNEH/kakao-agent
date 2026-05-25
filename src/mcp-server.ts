#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
  type Tool
} from '@modelcontextprotocol/sdk/types.js';
import { loadWhitelist } from './config.js';
import { crossRoomQuery, searchMessages, summarizeRoom, type MessageResult } from './database.js';

const SERVER_DEADLINE_MS = 10_000;

const tools: Tool[] = [
  {
    name: 'summarize_room',
    description:
      'Return KakaoTalk messages from one whitelisted chat room in logId order for a host LLM to summarize.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['roomId', 'periodFrom', 'periodTo'],
      properties: {
        roomId: { type: 'number', description: 'KakaoTalk chatroomId to read from.' },
        periodFrom: {
          type: 'number',
          description: 'Inclusive start time as Unix epoch milliseconds.'
        },
        periodTo: { type: 'number', description: 'Inclusive end time as Unix epoch milliseconds.' },
        limit: { type: 'number', description: 'Optional maximum result count, capped at 200.' }
      }
    }
  },
  {
    name: 'search_messages',
    description:
      'Search collected KakaoTalk messages by free-text query in whitelisted rooms only.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          minLength: 2,
          description: 'Text to search for in collected message content.'
        },
        limit: { type: 'number', description: 'Optional maximum result count, capped at 200.' }
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
          minLength: 2,
          description: 'Natural-language query or keyword to match across rooms.'
        },
        periodFrom: {
          type: 'number',
          description: 'Optional inclusive start time as Unix epoch milliseconds.'
        },
        periodTo: {
          type: 'number',
          description: 'Optional inclusive end time as Unix epoch milliseconds.'
        },
        limit: { type: 'number', description: 'Optional maximum result count, capped at 200.' }
      }
    }
  }
];

export async function startMcpServer(): Promise<void> {
  const server = new Server(
    { name: 'kakao-agent', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, (request: CallToolRequest) => {
    const startedAt = Date.now();
    try {
      const result = callKakaoTool(request);
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > SERVER_DEADLINE_MS) {
        return jsonResponse({
          error: 'partial_timeout',
          collected_so_far: Array.isArray(result) ? result.length : 0,
          deadline_exceeded: true
        });
      }
      return jsonResponse(result);
    } catch (error: unknown) {
      return jsonResponse({ error: 'validation_error', message: getErrorMessage(error) }, true);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function callKakaoTool(request: CallToolRequest): MessageResult[] {
  const args = toRecord(request.params.arguments);
  const whitelist = loadWhitelist();

  switch (request.params.name) {
    case 'summarize_room':
      return summarizeRoom({
        roomId: toInteger(args.roomId, 'roomId'),
        periodFrom: toInteger(args.periodFrom, 'periodFrom'),
        periodTo: toInteger(args.periodTo, 'periodTo'),
        whitelistedRoomIds: whitelist.chatroomIds,
        ...withOptionalInteger(args.limit, 'limit')
      });
    case 'search_messages':
      return searchMessages({
        query: toString(args.query, 'query'),
        whitelistedRoomIds: whitelist.chatroomIds,
        ...withOptionalInteger(args.limit, 'limit')
      });
    case 'cross_room_query':
      return crossRoomQuery({
        query: toString(args.query, 'query'),
        whitelistedRoomIds: whitelist.chatroomIds,
        ...withOptionalInteger(args.periodFrom, 'periodFrom'),
        ...withOptionalInteger(args.periodTo, 'periodTo'),
        ...withOptionalInteger(args.limit, 'limit')
      });
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
}

function jsonResponse(value: unknown, isError = false) {
  return { isError, content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function toRecord(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value))
    throw new Error('Tool arguments must be an object.');
  return value as Record<string, unknown>;
}

function toString(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string.`);
  return value;
}

function toInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error(`${name} must be an integer.`);
  return value;
}

function withOptionalInteger<Name extends string>(
  value: unknown,
  name: Name
): Partial<Record<Name, number>> {
  if (value === undefined) return {};
  return { [name]: toInteger(value, name) } as Partial<Record<Name, number>>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startMcpServer().catch((error: unknown) => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`kakao-agent MCP server failed: ${message}`);
    process.exitCode = 1;
  });
}
