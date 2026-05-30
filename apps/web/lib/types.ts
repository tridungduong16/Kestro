export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ScheduleStatus = "active" | "paused";

export type ExecutionStatus = "success" | "failed" | "running";

export type Schedule = {
  id: string;
  name: string;
  targetUrl: string;
  method: HttpMethod;
  cronExpression: string;
  status: ScheduleStatus;
  nextRunAt: string;
  lastRunAt: string;
  successRate: number;
  timeoutSeconds: number;
  retryCount: number;
  headers: string;
  payload: string;
};

export type Execution = {
  id: string;
  scheduleId: string;
  timestamp: string;
  status: ExecutionStatus;
  durationMs: number;
  statusCode?: number;
  error?: string;
};

