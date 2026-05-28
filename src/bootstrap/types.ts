export type MessageSource = 'export' | 'loco';
export type ParseStatus = 'parsed' | 'raw';
export type BootstrapRoomStateValue = 'pending' | 'in_progress' | 'success' | 'failed';

export interface BootstrapRoomConfig {
  roomId: number;
  roomName?: string;
  exportFilePath?: string;
}

export interface ParsedExportMessage {
  logId: number;
  chatroomId: number;
  roomDisplayName: string;
  senderId: string | null;
  senderName: string | null;
  messageType: string;
  content: string | null;
  mediaMeta: string | null;
  systemEventType: string | null;
  timestamp: number;
  isDeleted: number;
  collectedAt: number;
  source: MessageSource;
  parseStatus: ParseStatus;
}

export interface ParseExportOptions {
  chatroomId: number;
  roomDisplayName: string;
  defaultTimestamp?: number;
  collectedAt?: number;
}

export interface ParseExportStats {
  lineCount: number;
  messageCount: number;
  parsedCount: number;
  rawCount: number;
  systemCount: number;
  mediaCount: number;
}

export interface ParseExportResult {
  messages: ParsedExportMessage[];
  headerLines: string[];
  stats: ParseExportStats;
}

export interface BootstrapRoomState {
  bootstrap_state: BootstrapRoomStateValue;
  retry_count: number;
  last_error: string | null;
  completed_at: string | null;
}

export interface BootstrapStateFile {
  install_time: string | null;
  rooms: Record<string, BootstrapRoomState>;
}
