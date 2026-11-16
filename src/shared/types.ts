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
