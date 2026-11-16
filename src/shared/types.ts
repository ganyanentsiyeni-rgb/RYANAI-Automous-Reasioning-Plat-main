export type AppNodeEnvironment = 'development' | 'production' | 'staging';

export interface AppConfig {
  nodeEnv: AppNodeEnvironment;
  port: number;
  host: string;
  database: {
    url: string;
    maxConnections: number;
    timeoutMs: number;
  };
  redis: {
    url: string;
    timeout: number;
  };
  jwt: {
    secret: string;
    expiresIn: string;
  };
  api: {
    baseUrl: string;
    timeout: number;
  };
  mcp: {
    enabled: boolean;
    serverPort: number;
  };
  openai: {
    apiKey: string;
    model: string;
  };
  sentry: {
    enabled: boolean;
    dsn: string;
  };
  tauri: {
    enabled: boolean;
    allowedOrigins: string[];
  };
}

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  roles: string[];
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

export interface ReasoningRequest {
  prompt?: string;
  sessionId?: string;
  model?: string;
  [key: string]: unknown;
}

export interface WebSocketMessage {
  id: string;
  type: 'request' | 'response' | 'stream' | 'event' | 'error';
  channel: string;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
  timestamp: number;
}
