import type { Execution, Schedule } from "@/lib/types";

export const schedules: Schedule[] = [
  {
    id: "sch_billing_sync",
    name: "Billing reconciliation",
    targetUrl: "https://api.acme.test/jobs/billing/reconcile",
    method: "POST",
    cronExpression: "*/15 * * * *",
    status: "active",
    nextRunAt: "2026-05-30T00:00:00+10:00",
    lastRunAt: "2026-05-29T23:45:10+10:00",
    successRate: 99.2,
    timeoutSeconds: 30,
    retryCount: 2,
    headers: "{\n  \"Authorization\": \"Bearer ${BILLING_TOKEN}\"\n}",
    payload: "{\n  \"mode\": \"incremental\"\n}"
  },
  {
    id: "sch_partner_webhook",
    name: "Partner webhook ping",
    targetUrl: "https://partners.example.com/hooks/heartbeat",
    method: "GET",
    cronExpression: "0 */2 * * *",
    status: "active",
    nextRunAt: "2026-05-30T01:00:00+10:00",
    lastRunAt: "2026-05-29T23:00:04+10:00",
    successRate: 97.8,
    timeoutSeconds: 20,
    retryCount: 1,
    headers: "{\n  \"X-Source\": \"kestro\"\n}",
    payload: ""
  },
  {
    id: "sch_digest",
    name: "Daily digest fanout",
    targetUrl: "https://api.acme.test/notifications/digest",
    method: "POST",
    cronExpression: "0 8 * * 1-5",
    status: "active",
    nextRunAt: "2026-06-01T08:00:00+10:00",
    lastRunAt: "2026-05-29T08:00:20+10:00",
    successRate: 100,
    timeoutSeconds: 45,
    retryCount: 3,
    headers: "{\n  \"Content-Type\": \"application/json\"\n}",
    payload: "{\n  \"audience\": \"workspace-admins\"\n}"
  },
  {
    id: "sch_legacy_sync",
    name: "Legacy CRM sync",
    targetUrl: "https://legacy.example.net/sync",
    method: "POST",
    cronExpression: "30 * * * *",
    status: "paused",
    nextRunAt: "2026-05-30T00:30:00+10:00",
    lastRunAt: "2026-05-29T22:30:42+10:00",
    successRate: 88.4,
    timeoutSeconds: 60,
    retryCount: 4,
    headers: "{\n  \"X-Client\": \"kestro\"\n}",
    payload: "{\n  \"full\": false\n}"
  }
];

export const executions: Execution[] = [
  {
    id: "exe_1001",
    scheduleId: "sch_billing_sync",
    timestamp: "2026-05-29T23:45:10+10:00",
    status: "success",
    durationMs: 481,
    statusCode: 202
  },
  {
    id: "exe_1002",
    scheduleId: "sch_billing_sync",
    timestamp: "2026-05-29T23:30:09+10:00",
    status: "success",
    durationMs: 390,
    statusCode: 202
  },
  {
    id: "exe_1003",
    scheduleId: "sch_partner_webhook",
    timestamp: "2026-05-29T23:00:04+10:00",
    status: "success",
    durationMs: 112,
    statusCode: 204
  },
  {
    id: "exe_1004",
    scheduleId: "sch_legacy_sync",
    timestamp: "2026-05-29T22:30:42+10:00",
    status: "failed",
    durationMs: 60000,
    error: "Request timed out after 60 seconds"
  },
  {
    id: "exe_1005",
    scheduleId: "sch_digest",
    timestamp: "2026-05-29T08:00:20+10:00",
    status: "success",
    durationMs: 811,
    statusCode: 200
  }
];

