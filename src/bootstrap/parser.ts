import type { ParseExportOptions, ParseExportResult, ParsedExportMessage } from './types.js';

const KOREAN_MESSAGE_RE =
  /^\[(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*([^:\]]+)\s*:\s*(.*)\]$/;
const KOREAN_SYSTEM_RE =
  /^\[(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*(오전|오후)\s*(\d{1,2}):(\d{2}),\s*(.+)\]$/;
const MEDIA_LABELS = new Set(['사진', '동영상', '파일', '음성메시지']);

interface DraftMessage extends ParsedExportMessage {
  lineIndex: number;
}

export function parseKakaoExportText(text: string, options: ParseExportOptions): ParseExportResult {
  const collectedAt = options.collectedAt ?? Date.now();
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const messages: DraftMessage[] = [];
  const headerLines: string[] = [];
  let seenMessage = false;
  let lastMessage: DraftMessage | null = null;
  let lastTimestamp = options.defaultTimestamp ?? collectedAt;

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    const line = rawLine.trimEnd();
    if (line.trim().length === 0) continue;

    const parsed = parseUserMessage(line, index, options, collectedAt);
    if (parsed) {
      seenMessage = true;
      messages.push(parsed);
      lastMessage = parsed;
      lastTimestamp = parsed.timestamp;
      continue;
    }

    const system = parseSystemMessage(line, index, options, collectedAt);
    if (system) {
      seenMessage = true;
      messages.push(system);
      lastMessage = system;
      lastTimestamp = system.timestamp;
      continue;
    }

    if (!seenMessage && isHeaderLine(line)) {
      headerLines.push(line);
      continue;
    }

    if (lastMessage && shouldAppendToPrevious(line)) {
      lastMessage.content = lastMessage.content ? `${lastMessage.content}\n${line}` : line;
      continue;
    }

    const raw = makeBaseMessage({
      lineIndex: index,
      chatroomId: options.chatroomId,
      roomDisplayName: options.roomDisplayName,
      timestamp: lastTimestamp,
      collectedAt
    });
    raw.parseStatus = 'raw';
    raw.content = line;
    raw.senderName = null;
    raw.senderId = null;
    raw.messageType = 'raw';
    messages.push(raw);
    lastMessage = raw;
    seenMessage = true;
  }

  const finalized = messages.map((message) => ({
    logId: message.logId,
    chatroomId: message.chatroomId,
    roomDisplayName: message.roomDisplayName,
    senderId: message.senderId,
    senderName: message.senderName,
    messageType: message.messageType,
    content: message.content,
    mediaMeta: message.mediaMeta,
    systemEventType: message.systemEventType,
    timestamp: message.timestamp,
    isDeleted: message.isDeleted,
    collectedAt: message.collectedAt,
    source: message.source,
    parseStatus: message.parseStatus
  }));
  return {
    messages: finalized,
    headerLines,
    stats: {
      lineCount: lines.filter((line) => line.trim().length > 0).length,
      messageCount: finalized.length,
      parsedCount: finalized.filter((message) => message.parseStatus === 'parsed').length,
      rawCount: finalized.filter((message) => message.parseStatus === 'raw').length,
      systemCount: finalized.filter((message) => message.messageType === 'system').length,
      mediaCount: finalized.filter((message) => message.messageType === 'media_meta').length
    }
  };
}

function parseUserMessage(
  line: string,
  lineIndex: number,
  options: ParseExportOptions,
  collectedAt: number
): DraftMessage | null {
  const match = line.match(KOREAN_MESSAGE_RE);
  if (!match) return null;
  const timestamp = koreanTimestampToEpoch(match);
  const senderName = match[7]?.trim() ?? 'unknown';
  const content = match[8] ?? '';
  const message = makeBaseMessage({
    lineIndex,
    chatroomId: options.chatroomId,
    roomDisplayName: options.roomDisplayName,
    timestamp,
    collectedAt
  });
  message.senderName = senderName;
  message.senderId = `export:${stableSenderId(senderName)}`;
  message.content = content;
  const systemEventType = inferSystemEventType(content);
  if (systemEventType) {
    message.messageType = 'system';
    message.systemEventType = systemEventType;
    return message;
  }
  classifyContent(message, content);
  return message;
}

function parseSystemMessage(
  line: string,
  lineIndex: number,
  options: ParseExportOptions,
  collectedAt: number
): DraftMessage | null {
  const match = line.match(KOREAN_SYSTEM_RE);
  if (!match) return null;
  const body = match[7]?.trim() ?? '';
  const eventType = inferSystemEventType(body);
  if (!eventType) return null;
  const message = makeBaseMessage({
    lineIndex,
    chatroomId: options.chatroomId,
    roomDisplayName: options.roomDisplayName,
    timestamp: koreanTimestampToEpoch(match),
    collectedAt
  });
  message.senderName = 'system';
  message.senderId = 'system';
  message.messageType = 'system';
  message.systemEventType = eventType;
  message.content = body;
  return message;
}

function makeBaseMessage(options: {
  lineIndex: number;
  chatroomId: number;
  roomDisplayName: string;
  timestamp: number;
  collectedAt: number;
}): DraftMessage {
  return {
    lineIndex: options.lineIndex,
    logId: -900_000_000 + options.lineIndex,
    chatroomId: options.chatroomId,
    roomDisplayName: options.roomDisplayName,
    senderId: null,
    senderName: null,
    messageType: 'text',
    content: null,
    mediaMeta: null,
    systemEventType: null,
    timestamp: options.timestamp,
    isDeleted: 0,
    collectedAt: options.collectedAt,
    source: 'export',
    parseStatus: 'parsed'
  };
}

function koreanTimestampToEpoch(match: RegExpMatchArray): number {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const meridiem = match[4];
  const hour12 = Number(match[5]);
  const minute = Number(match[6]);
  let hour = hour12 % 12;
  if (meridiem === '오후') hour += 12;
  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
}

function classifyContent(message: DraftMessage, content: string): void {
  const label = content.replace(/^\[(.*)\]$/, '$1').trim();
  if (content.trim() === '[이모티콘]') {
    message.messageType = 'emoticon';
    return;
  }
  if (MEDIA_LABELS.has(label)) {
    message.messageType = 'media_meta';
    message.mediaMeta = JSON.stringify({ label });
  }
}

function inferSystemEventType(body: string): string | null {
  if (body.includes('들어왔습니다') || body.includes('입장')) return 'member_join';
  if (body.includes('나갔습니다') || body.includes('퇴장')) return 'member_leave';
  if (body.includes('초대')) return 'invite';
  if (body.includes('방제') || body.includes('방 이름') || body.includes('채팅방 이름')) {
    return 'room_title_change';
  }
  return null;
}

function isHeaderLine(line: string): boolean {
  return /^(카카오톡|저장한 날짜|대화 상대|대화내용|채팅방|Talk_)/i.test(line.trim());
}

function shouldAppendToPrevious(line: string): boolean {
  return !line.startsWith('[');
}

function stableSenderId(senderName: string): string {
  let hash = 0;
  for (const char of senderName) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
