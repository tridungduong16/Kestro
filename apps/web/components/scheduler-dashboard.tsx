"use client";

import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Code2,
  Edit3,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Server,
  Timer,
  Trash2,
  Upload,
  XCircle
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  Execution,
  ExecutionStatus,
  HttpMethod,
  Schedule,
  ScheduleStatus
} from "@/lib/types";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
const statuses = ["active", "paused"] as const;
const emptySchedules: Schedule[] = [];
const emptyExecutions: Execution[] = [];
const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080";

const scheduleSchema = z.object({
  name: z.string().min(3, "Use at least 3 characters."),
  targetUrl: z.string().url("Enter a valid HTTP endpoint."),
  method: z.enum(methods),
  cronExpression: z.string().min(5, "Enter a cron expression."),
  status: z.enum(statuses),
  headers: z
    .string()
    .optional()
    .refine((value) => isJsonObjectOrEmpty(value), "Headers must be a JSON object."),
  payload: z.string().optional(),
  timeoutSeconds: z.coerce.number().min(1).max(120),
  retryCount: z.coerce.number().min(0).max(5)
});

type ScheduleFormInput = z.input<typeof scheduleSchema>;
type ScheduleFormValues = z.output<typeof scheduleSchema>;

type BrunoImportPreview = {
  source: {
    fileName?: string;
    format: string;
  };
  schedule: {
    name: string;
    targetUrl: string;
    method: string;
    cronExpression: string;
    headers: unknown;
    payload?: string | null;
    status: string;
    timeoutSeconds: number;
    retryCount: number;
  };
  warnings: string[];
  unsupportedBlocks: string[];
};

type ApiSchedule = {
  id: string;
  name: string;
  targetUrl: string;
  method: string;
  cronExpression: string;
  headers: unknown;
  payload?: string | null;
  status: string;
  timeoutSeconds: number;
  retryCount: number;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
};

type ApiExecution = {
  id: string;
  scheduleId: string;
  startedAt: string;
  finishedAt: string;
  status: string;
  statusCode?: number | null;
  durationMs: number;
  error?: string | null;
  responseBody?: string | null;
};

type ScheduleRequest = {
  name: string;
  targetUrl: string;
  method: HttpMethod;
  cronExpression: string;
  headers: Record<string, unknown>;
  payload: string;
  status: ScheduleStatus;
  timeoutSeconds: number;
  retryCount: number;
};

type RunNotice = {
  scheduleId: string;
  status: "failed" | "running" | "success";
  message: string;
};

type ScheduleBuilderMode = "custom" | "daily" | "hourly" | "interval" | "monthly" | "weekly";

type ScheduleBuilderState = {
  customExpression: string;
  dayOfMonth: number;
  dayOfWeek: string;
  hour: number;
  intervalMinutes: number;
  minute: number;
  mode: ScheduleBuilderMode;
};

type DashboardView = "api" | "history" | "schedules" | "workers";

const scheduleModes: Array<{ label: string; value: ScheduleBuilderMode }> = [
  { label: "Every", value: "interval" },
  { label: "Hourly", value: "hourly" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Monthly", value: "monthly" },
  { label: "Cron", value: "custom" }
];

const weekdays = [
  { label: "Sun", value: "0" },
  { label: "Mon", value: "1" },
  { label: "Tue", value: "2" },
  { label: "Wed", value: "3" },
  { label: "Thu", value: "4" },
  { label: "Fri", value: "5" },
  { label: "Sat", value: "6" }
];

const dashboardViews: Array<{
  id: DashboardView;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  subtitle: string;
  title: string;
}> = [
  {
    id: "schedules",
    icon: Activity,
    label: "Schedules",
    subtitle: "Command Center",
    title: "Schedule operations"
  },
  {
    id: "history",
    icon: Clock3,
    label: "History",
    subtitle: "Execution Log",
    title: "Run history"
  },
  {
    id: "workers",
    icon: Server,
    label: "Workers",
    subtitle: "Runtime Mesh",
    title: "Worker status"
  },
  {
    id: "api",
    icon: Code2,
    label: "API",
    subtitle: "Developer Surface",
    title: "API reference"
  }
];

function isDashboardView(value: string): value is DashboardView {
  return dashboardViews.some((view) => view.id === value);
}

const scheduleQueryKey = ["schedules"];
const executionQueryKey = ["executions"];

export function SchedulerDashboard() {
  const queryClient = useQueryClient();
  const brunoFileInputRef = useRef<HTMLInputElement>(null);
  const runNoticeTimeoutRef = useRef<number | null>(null);
  const [activeView, setActiveView] = useState<DashboardView>("schedules");
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSource, setImportSource] = useState<string | null>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [runNotice, setRunNotice] = useState<RunNotice | null>(null);

  const schedulesQuery = useQuery({
    queryKey: scheduleQueryKey,
    queryFn: fetchSchedules
  });

  const scheduleRecords = schedulesQuery.data ?? emptySchedules;
  const scheduleIds = useMemo(
    () => scheduleRecords.map((schedule) => schedule.id),
    [scheduleRecords]
  );

  const executionsQuery = useQuery({
    enabled: schedulesQuery.isSuccess,
    queryKey: [...executionQueryKey, scheduleIds.join(",")],
    queryFn: () => fetchExecutionsForSchedules(scheduleIds)
  });

  const executions = executionsQuery.data ?? emptyExecutions;
  const schedules = useMemo(
    () => enrichSchedulesWithExecutions(scheduleRecords, executions),
    [executions, scheduleRecords]
  );
  const selectedSchedule = schedules.find((schedule) => schedule.id === selectedId) ?? schedules[0];
  const latestExecutionBySchedule = useMemo(() => {
    const latestBySchedule = new Map<string, Execution>();

    executions.forEach((execution) => {
      const current = latestBySchedule.get(execution.scheduleId);
      if (
        !current ||
        new Date(execution.timestamp).getTime() > new Date(current.timestamp).getTime()
      ) {
        latestBySchedule.set(execution.scheduleId, execution);
      }
    });

    return latestBySchedule;
  }, [executions]);
  const activeViewMeta =
    dashboardViews.find((view) => view.id === activeView) ?? dashboardViews[0];

  useEffect(() => {
    if (!schedules.length) {
      setSelectedId("");
      return;
    }

    if (!schedules.some((schedule) => schedule.id === selectedId)) {
      setSelectedId(schedules[0].id);
    }
  }, [schedules, selectedId]);

  useEffect(() => {
    function syncViewFromHash() {
      const hashView = window.location.hash.replace("#", "");
      if (isDashboardView(hashView)) {
        setActiveView(hashView);
      }
    }

    syncViewFromHash();
    window.addEventListener("hashchange", syncViewFromHash);
    return () => window.removeEventListener("hashchange", syncViewFromHash);
  }, []);

  useEffect(() => {
    return () => {
      if (runNoticeTimeoutRef.current) {
        window.clearTimeout(runNoticeTimeoutRef.current);
      }
    };
  }, []);

  const filteredSchedules = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    if (!normalized) {
      return schedules;
    }

    return schedules.filter((schedule) => {
      return [schedule.name, schedule.targetUrl, schedule.method, schedule.status]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [schedules, search]);

  const filteredExecutions = useMemo(() => {
    const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
    const sortedExecutions = [...executions].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const normalized = search.trim().toLowerCase();

    if (!normalized) {
      return sortedExecutions;
    }

    return sortedExecutions.filter((execution) => {
      const schedule = scheduleById.get(execution.scheduleId);
      return [
        execution.status,
        execution.error,
        execution.statusCode?.toString(),
        schedule?.name,
        schedule?.targetUrl,
        schedule?.method
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [executions, schedules, search]);

  const stats = useMemo(() => {
    const active = schedules.filter((schedule) => schedule.status === "active").length;
    const failedRuns = executions.filter((execution) => execution.status === "failed").length;
    const avgSuccess =
      schedules.length > 0
        ? schedules.reduce((sum, schedule) => sum + schedule.successRate, 0) / schedules.length
        : 0;
    const nextRun = schedules
      .filter((schedule) => schedule.status === "active")
      .sort(
        (a, b) =>
          new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime()
      )[0];

    return {
      active,
      failedRuns,
      avgSuccess,
      nextRun
    };
  }, [executions, schedules]);

  const form = useForm<ScheduleFormInput, unknown, ScheduleFormValues>({
    resolver: zodResolver(scheduleSchema),
    defaultValues: getFormDefaults()
  });

  const upsertSchedule = useMutation({
    mutationFn: async (values: ScheduleFormValues) => {
      const payload = buildScheduleRequest(values);

      if (editingSchedule) {
        return updateSchedule(editingSchedule.id, payload);
      }

      return createSchedule(payload);
    },
    onSuccess: (schedule) => {
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
      void queryClient.invalidateQueries({ queryKey: executionQueryKey });
      setSelectedId(schedule.id);
      setDialogOpen(false);
      setEditingSchedule(null);
      clearImportState();
      form.reset(getFormDefaults());
    }
  });

  const importBrunoRequest = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`${apiBaseUrl}/api/imports/bruno/request`, {
        body,
        method: "POST"
      });

      if (!response.ok) {
        let message = `Bruno import failed with HTTP ${response.status}.`;
        try {
          const payload = (await response.json()) as { error?: string };
          if (payload.error) {
            message = payload.error;
          }
        } catch {
          // Keep the status-based message when the server does not return JSON.
        }
        throw new Error(message);
      }

      return (await response.json()) as BrunoImportPreview;
    },
    onError: (error) => {
      setImportError(error instanceof Error ? error.message : "Unable to import Bruno file.");
    },
    onMutate: () => {
      setImportError(null);
    },
    onSuccess: (preview) => {
      setEditingSchedule(null);
      setImportSource(preview.source.fileName ?? "Bruno request");
      setImportWarnings(buildImportWarnings(preview));
      form.reset(getBrunoFormDefaults(preview.schedule));
      setDialogOpen(true);
    }
  });

  const runNow = useMutation({
    mutationFn: async (schedule: Schedule) => {
      return runScheduleNow(schedule.id);
    },
    onError: (error, schedule) => {
      showRunNotice(
        {
          scheduleId: schedule.id,
          status: "failed",
          message: getErrorMessage(error) ?? "Run failed"
        },
        6000
      );
    },
    onMutate: (schedule) => {
      setSelectedId(schedule.id);
      showRunNotice({
        scheduleId: schedule.id,
        status: "running",
        message: "Running now"
      });
    },
    onSuccess: (execution, schedule) => {
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
      void queryClient.invalidateQueries({ queryKey: executionQueryKey });
      showRunNotice(
        {
          scheduleId: schedule.id,
          status: execution.status === "success" ? "success" : "failed",
          message:
            execution.status === "success"
              ? `Run succeeded${execution.statusCode ? ` - HTTP ${execution.statusCode}` : ""}`
              : execution.error ?? "Run failed"
        },
        6000
      );
    }
  });

  const toggleSchedule = useMutation({
    mutationFn: async (schedule: Schedule) => {
      const nextStatus: ScheduleStatus =
        schedule.status === "active" ? "paused" : "active";
      return updateSchedule(schedule.id, buildScheduleRequest({ ...schedule, status: nextStatus }));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    }
  });

  const deleteSchedule = useMutation({
    mutationFn: async (schedule: Schedule) => {
      await removeSchedule(schedule.id);
      return schedule.id;
    },
    onSuccess: (scheduleId) => {
      if (selectedId === scheduleId) {
        setSelectedId("");
      }
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
      void queryClient.invalidateQueries({ queryKey: executionQueryKey });
    }
  });

  function openCreateDialog() {
    setEditingSchedule(null);
    clearImportState();
    form.reset(getFormDefaults());
    setDialogOpen(true);
  }

  function openEditDialog(schedule: Schedule) {
    setEditingSchedule(schedule);
    clearImportState();
    form.reset(getFormDefaults(schedule));
    setDialogOpen(true);
  }

  function clearImportState() {
    setImportError(null);
    setImportSource(null);
    setImportWarnings([]);
  }

  function showRunNotice(notice: RunNotice, timeoutMs?: number) {
    if (runNoticeTimeoutRef.current) {
      window.clearTimeout(runNoticeTimeoutRef.current);
      runNoticeTimeoutRef.current = null;
    }

    setRunNotice(notice);

    if (timeoutMs) {
      runNoticeTimeoutRef.current = window.setTimeout(() => {
        setRunNotice((current) =>
          current?.scheduleId === notice.scheduleId && current.status === notice.status
            ? null
            : current
        );
        runNoticeTimeoutRef.current = null;
      }, timeoutMs);
    }
  }

  function openBrunoImportPicker() {
    brunoFileInputRef.current?.click();
  }

  function handleBrunoFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    importBrunoRequest.mutate(file);
  }

  function selectView(view: DashboardView) {
    setActiveView(view);
    setSearch("");
    window.history.replaceState(null, "", `#${view}`);
  }

  const apiErrorMessage = getErrorMessage(
    schedulesQuery.error ??
      executionsQuery.error ??
      upsertSchedule.error ??
      runNow.error ??
      toggleSchedule.error ??
      deleteSchedule.error
  );

  return (
    <main className="min-h-screen bg-linear-black text-linear-porcelain">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-linear-charcoal bg-linear-graphite text-linear-porcelain lg:flex">
        <div className="flex h-16 items-center gap-3 px-4">
          <Image
            alt=""
            className="h-9 w-9 rounded-md object-cover"
            height={40}
            priority
            src="/logo.png"
            width={40}
          />
          <div>
            <p className="text-sm font-semibold text-linear-porcelain">Kestro</p>
          </div>
        </div>
        <nav className="space-y-1 px-2">
          {dashboardViews.map((item) => (
            <button
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-sm px-2 text-sm font-medium transition-colors",
                activeView === item.id
                  ? "bg-linear-charcoal text-linear-porcelain shadow-linear-inset"
                  : "text-linear-storm hover:bg-linear-slate hover:text-linear-steel"
              )}
              key={item.label}
              onClick={() => selectView(item.id)}
              type="button"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto p-3">
          <div className="rounded-md border border-linear-charcoal bg-linear-slate p-3 shadow-panel">
            <div className="flex items-center justify-between border-b border-linear-charcoal pb-2">
              <p className="text-sm font-medium text-linear-porcelain">Runtime</p>
              <span className="h-2 w-2 rounded-full bg-linear-lime" />
            </div>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-linear-storm">Worker</span>
                <span className="font-mono text-linear-steel">online</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-linear-storm">Queue latency</span>
                <span className="font-mono text-linear-steel">21ms</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-linear-storm">Tick interval</span>
                <span className="font-mono text-linear-steel">30s</span>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <section className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-linear-charcoal bg-linear-black/90 backdrop-blur-xl">
          <div className="flex min-h-16 flex-col gap-3 px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between lg:px-6">
            <div>
              <div className="flex items-center gap-2 lg:hidden">
                <Image
                  alt=""
                  className="h-9 w-9 rounded-md object-cover"
                  height={36}
                  priority
                  src="/logo.png"
                  width={36}
                />
                <p className="text-base font-semibold text-linear-porcelain">Kestro</p>
              </div>
              <p className="mt-2 font-mono text-[10px] font-medium uppercase text-linear-storm lg:mt-0">
                {activeViewMeta.subtitle}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-[-0.22px] text-linear-porcelain">
                {activeViewMeta.title}
              </h1>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                accept=".bru,text/plain"
                className="hidden"
                onChange={handleBrunoFileChange}
                ref={brunoFileInputRef}
                type="file"
              />
              {activeView === "schedules" || activeView === "history" ? (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-linear-storm" />
                  <Input
                    className="w-full pl-9 sm:w-72"
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={activeView === "history" ? "Search history" : "Search schedules"}
                    value={search}
                  />
                </div>
              ) : null}
              <Button
                disabled={importBrunoRequest.isPending}
                onClick={openBrunoImportPicker}
                variant="outline"
              >
                <Upload className="h-4 w-4" />
                {importBrunoRequest.isPending ? "Importing" : "Import .bru"}
              </Button>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                New Schedule
              </Button>
            </div>
          </div>
          <nav className="grid grid-cols-4 gap-1 px-4 pb-3 sm:px-5 lg:hidden">
            {dashboardViews.map((item) => (
              <button
                className={cn(
                  "flex h-8 items-center justify-center gap-1 rounded-sm px-2 text-xs font-medium transition-colors",
                  activeView === item.id
                    ? "bg-linear-charcoal text-linear-porcelain shadow-linear-inset"
                    : "text-linear-storm hover:bg-linear-slate hover:text-linear-steel"
                )}
                key={item.id}
                onClick={() => selectView(item.id)}
                type="button"
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5 sm:px-5 lg:px-6">
          {apiErrorMessage ? (
            <div className="rounded-md border border-linear-red/30 bg-linear-red/10 px-4 py-3 text-sm text-[#ff8585]">
              API error: {apiErrorMessage}
            </div>
          ) : null}

          {importError ? (
            <div className="rounded-md border border-linear-red/30 bg-linear-red/10 px-4 py-3 text-sm text-[#ff8585]">
              {importError}
            </div>
          ) : null}

          {activeView === "schedules" ? (
            <>
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
            <div className="relative overflow-hidden rounded-md border border-linear-charcoal bg-linear-slate p-5 text-linear-porcelain shadow-panel sm:p-6">
              <span className="absolute inset-x-0 top-0 h-px bg-linear-lime/80" />
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] font-medium uppercase text-linear-lime">
                    Scheduler Command Center
                  </p>
                  <h2 className="mt-3 max-w-2xl text-[32px] font-medium leading-[1.13] tracking-[-0.22px] text-linear-porcelain">
                    Monitor jobs, retries, and endpoint health from one dense scheduler view.
                  </h2>
                  <p className="mt-4 max-w-xl text-sm leading-6 text-linear-storm">
                    {selectedSchedule
                      ? `${selectedSchedule.name} is selected for inspection.`
                      : "Create a schedule to start tracking execution activity."}
                  </p>
                </div>

                <div className="border-t border-linear-charcoal pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] font-medium uppercase text-linear-storm">
                      Next active run
                    </p>
                    <span className="h-2 w-2 rounded-full bg-linear-lime" />
                  </div>
                  <p className="mt-4 text-[32px] font-medium leading-none tracking-[-0.22px] text-linear-porcelain">
                    {stats.nextRun ? formatTime(stats.nextRun.nextRunAt) : "None"}
                  </p>
                  <p className="mt-3 truncate text-sm text-linear-steel">
                    {stats.nextRun ? stats.nextRun.name : "No active jobs"}
                  </p>
                  <div className="mt-6 space-y-3 border-t border-linear-charcoal pt-4">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-linear-storm">Worker</span>
                      <span className="font-mono text-linear-steel">online</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-linear-storm">Queue latency</span>
                      <span className="font-mono text-linear-steel">21ms</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-7 grid gap-4 border-t border-linear-charcoal pt-5 sm:grid-cols-3">
                <div>
                  <p className="font-mono text-[10px] font-medium uppercase text-linear-storm">
                    Active jobs
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-linear-porcelain">{stats.active}</p>
                </div>
                <div>
                  <p className="font-mono text-[10px] font-medium uppercase text-linear-storm">
                    Average success
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-linear-porcelain">
                    {stats.avgSuccess.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <p className="font-mono text-[10px] font-medium uppercase text-linear-storm">
                    Recent failures
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-linear-porcelain">{stats.failedRuns}</p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <MetricCard
                description="Across configured jobs"
                icon={CheckCircle2}
                label="Success rate"
                tone="success"
                value={`${stats.avgSuccess.toFixed(1)}%`}
              />
              <MetricCard
                description="Needs attention"
                icon={AlertTriangle}
                label="Failed runs"
                tone="danger"
                value={stats.failedRuns.toString()}
              />
            </div>
          </section>

          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              description="Currently live"
              icon={Activity}
              label="Live jobs"
              tone="primary"
              value={stats.active.toString()}
            />
            <MetricCard
              description="Recorded executions"
              icon={CheckCircle2}
              label="Total runs"
              tone="success"
              value={executions.length.toString()}
            />
            <MetricCard
              description={stats.nextRun ? stats.nextRun.name : "No active jobs"}
              icon={Timer}
              label="Next run"
              tone="secondary"
              value={stats.nextRun ? formatTime(stats.nextRun.nextRunAt) : "None"}
            />
            <MetricCard
              description={selectedSchedule ? selectedSchedule.name : "No schedule selected"}
              icon={CalendarClock}
              label="Selected job"
              tone="dark"
              value={selectedSchedule ? formatCronSummary(selectedSchedule.cronExpression) : "None"}
            />
          </section>

          <section>
            <div className="min-w-0 space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-[10px] font-medium uppercase text-linear-lime">
                    Workflow queue
                  </p>
                  <h2 className="mt-1 text-xl font-semibold tracking-[-0.15px] text-linear-porcelain">Schedules</h2>
                  <p className="mt-1 text-sm text-linear-storm">
                    {filteredSchedules.length} jobs configured
                  </p>
                </div>
                <Button
                  disabled={schedulesQuery.isFetching || executionsQuery.isFetching}
                  onClick={() => {
                    void schedulesQuery.refetch();
                    void executionsQuery.refetch();
                  }}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>

              <div className="space-y-3">
                {filteredSchedules.length > 0 ? (
                  filteredSchedules.map((schedule) => (
                    <ScheduleListItem
                      key={schedule.id}
                      latestExecution={latestExecutionBySchedule.get(schedule.id)}
                      onDelete={() => deleteSchedule.mutate(schedule)}
                      onEdit={() => openEditDialog(schedule)}
                      onRunNow={() => runNow.mutate(schedule)}
                      onSelect={() => setSelectedId(schedule.id)}
                      onToggle={() => toggleSchedule.mutate(schedule)}
                      runNotice={runNotice?.scheduleId === schedule.id ? runNotice : undefined}
                      runPending={runNow.isPending && runNow.variables?.id === schedule.id}
                      schedule={schedule}
                      selected={selectedSchedule?.id === schedule.id}
                    />
                  ))
                ) : (
                  <div className="flex min-h-48 items-center justify-center rounded-md border border-dashed border-linear-charcoal bg-linear-graphite text-sm text-linear-storm">
                    No schedules match your search
                  </div>
                )}
              </div>
            </div>
          </section>
            </>
          ) : null}

          {activeView === "history" ? (
            <HistoryView
              executions={filteredExecutions}
              schedules={schedules}
              totalExecutions={executions.length}
            />
          ) : null}

          {activeView === "workers" ? (
            <WorkersView
              activeSchedules={stats.active}
              failedRuns={stats.failedRuns}
              nextRun={stats.nextRun}
              totalSchedules={schedules.length}
            />
          ) : null}

          {activeView === "api" ? (
            <ApiView
              apiBaseUrl={apiBaseUrl}
              onCreateSchedule={openCreateDialog}
              onImportBruno={openBrunoImportPicker}
            />
          ) : null}
        </div>
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            clearImportState();
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSchedule ? "Edit schedule" : "Create schedule"}</DialogTitle>
            <DialogDescription>
              Configure the target, schedule, retry policy, and request body.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={form.handleSubmit((values) => upsertSchedule.mutate(values))}
          >
            {importWarnings.length > 0 ? (
              <div className="rounded-md border border-linear-lime/30 bg-linear-lime/10 p-4 text-sm text-linear-steel">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-linear-lime" />
                  <div>
                    <p className="font-medium text-linear-porcelain">
                      Imported from {importSource ?? "Bruno request"}
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-linear-storm">
                      {importWarnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Schedule name" error={form.formState.errors.name?.message}>
                <Input placeholder="Billing reconciliation" {...form.register("name")} />
              </Field>
              <Field label="Schedule" error={form.formState.errors.cronExpression?.message}>
                <input type="hidden" {...form.register("cronExpression")} />
                <ScheduleBuilder
                  onChange={(value) =>
                    form.setValue("cronExpression", value, {
                      shouldDirty: true,
                      shouldValidate: true
                    })
                  }
                  value={form.watch("cronExpression")}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-[160px_1fr]">
              <Field label="Method" error={form.formState.errors.method?.message}>
                <Select
                  onValueChange={(value) =>
                    form.setValue("method", value as HttpMethod, {
                      shouldDirty: true,
                      shouldValidate: true
                    })
                  }
                  value={form.watch("method")}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Method" />
                  </SelectTrigger>
                  <SelectContent>
                    {methods.map((method) => (
                      <SelectItem key={method} value={method}>
                        {method}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Target URL" error={form.formState.errors.targetUrl?.message}>
                <Input
                  placeholder="https://api.example.com/jobs/reconcile"
                  {...form.register("targetUrl")}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Headers" error={form.formState.errors.headers?.message}>
                <Textarea
                  className="font-mono text-xs"
                  placeholder={'{\n  "Authorization": "Bearer token"\n}'}
                  {...form.register("headers")}
                />
              </Field>
              <Field label="Payload" error={form.formState.errors.payload?.message}>
                <Textarea
                  className="font-mono text-xs"
                  placeholder={'{\n  "mode": "incremental"\n}'}
                  {...form.register("payload")}
                />
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_1fr_160px]">
              <Field label="Timeout seconds" error={form.formState.errors.timeoutSeconds?.message}>
                <Input
                  min={1}
                  max={120}
                  type="number"
                  {...form.register("timeoutSeconds", { valueAsNumber: true })}
                />
              </Field>
              <Field label="Retry count" error={form.formState.errors.retryCount?.message}>
                <Input
                  min={0}
                  max={5}
                  type="number"
                  {...form.register("retryCount", { valueAsNumber: true })}
                />
              </Field>
              <div className="flex items-end">
                <label className="flex h-9 w-full items-center justify-between rounded-md border border-linear-charcoal bg-linear-gunmetal px-3 text-sm">
                  <span className="font-medium text-linear-steel">
                    {form.watch("status") === "active" ? "Active" : "Paused"}
                  </span>
                  <Switch
                    checked={form.watch("status") === "active"}
                    onCheckedChange={(checked) =>
                      form.setValue("status", checked ? "active" : "paused", {
                        shouldDirty: true
                      })
                    }
                  />
                </label>
              </div>
            </div>

            <DialogFooter>
              <Button
                onClick={() => {
                  setDialogOpen(false);
                  clearImportState();
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
              <Button disabled={upsertSchedule.isPending} type="submit">
                {editingSchedule ? "Save changes" : "Create schedule"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function HistoryView({
  executions,
  schedules,
  totalExecutions
}: {
  executions: Execution[];
  schedules: Schedule[];
  totalExecutions: number;
}) {
  const scheduleById = new Map(schedules.map((schedule) => [schedule.id, schedule]));
  const visibleFailures = executions.filter((execution) => execution.status === "failed").length;
  const visibleSuccess = executions.filter((execution) => execution.status === "success").length;

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard
          description={`${totalExecutions} total recorded`}
          icon={Clock3}
          label="Visible runs"
          tone="primary"
          value={executions.length.toString()}
        />
        <MetricCard
          description="In the current filter"
          icon={CheckCircle2}
          label="Successful"
          tone="success"
          value={visibleSuccess.toString()}
        />
        <MetricCard
          description="Require inspection"
          icon={AlertTriangle}
          label="Failed"
          tone="danger"
          value={visibleFailures.toString()}
        />
      </div>

      <Card>
        <CardHeader className="border-b border-linear-charcoal">
          <p className="font-mono text-[10px] font-medium uppercase text-linear-lime">
            Execution stream
          </p>
          <CardTitle className="tracking-[-0.15px]">Recent job activity</CardTitle>
          <CardDescription>
            Runs are sorted newest first and include endpoint, duration, and result.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {executions.length > 0 ? (
            <div className="divide-y divide-linear-charcoal">
              {executions.map((execution) => {
                const schedule = scheduleById.get(execution.scheduleId);
                return (
                  <div
                    className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[minmax(220px,1.3fr)_minmax(160px,0.8fr)_minmax(140px,0.7fr)_auto] md:items-center"
                    key={execution.id}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                          execution.status === "success"
                            ? "bg-linear-emerald/15 text-[#77df8d]"
                            : "bg-linear-red/15 text-[#ff8585]"
                        )}
                      >
                        {execution.status === "success" ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <XCircle className="h-4 w-4" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-linear-porcelain">
                          {schedule?.name ?? "Unknown schedule"}
                        </p>
                        <p className="mt-1 truncate font-mono text-xs text-linear-storm">
                          {schedule ? `${schedule.method} ${getEndpointHost(schedule.targetUrl)}` : execution.scheduleId}
                        </p>
                      </div>
                    </div>
                    <ScheduleDatum
                      label="Executed"
                      meta={formatRelativeTime(execution.timestamp)}
                      value={formatDate(execution.timestamp)}
                    />
                    <ScheduleDatum
                      label="Duration"
                      meta={execution.statusCode ? `HTTP ${execution.statusCode}` : execution.error}
                      tone={execution.status === "failed" ? "danger" : "neutral"}
                      value={formatDuration(execution.durationMs)}
                    />
                    <ExecutionBadge status={execution.status} />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-60 items-center justify-center rounded-md border border-dashed border-linear-charcoal text-sm text-linear-storm">
              No executions match your search
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function WorkersView({
  activeSchedules,
  failedRuns,
  nextRun,
  totalSchedules
}: {
  activeSchedules: number;
  failedRuns: number;
  nextRun?: Schedule;
  totalSchedules: number;
}) {
  const workers = [
    {
      id: "worker-primary",
      name: "scheduler-primary",
      role: "Cron dispatcher",
      status: "online",
      load: "34%",
      latency: "21ms"
    },
    {
      id: "worker-retry",
      name: "retry-runner",
      role: "Retry queue",
      status: failedRuns > 0 ? "watching" : "idle",
      load: failedRuns > 0 ? "18%" : "4%",
      latency: "43ms"
    },
    {
      id: "worker-import",
      name: "bruno-importer",
      role: "Request parser",
      status: "ready",
      load: "2%",
      latency: "9ms"
    }
  ];

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          description={`${totalSchedules} schedules configured`}
          icon={Activity}
          label="Active jobs"
          tone="primary"
          value={activeSchedules.toString()}
        />
        <MetricCard
          description={nextRun ? nextRun.name : "No active jobs"}
          icon={Timer}
          label="Next dispatch"
          tone="dark"
          value={nextRun ? formatTime(nextRun.nextRunAt) : "None"}
        />
        <MetricCard
          description="Current scheduler tick"
          icon={RefreshCcw}
          label="Interval"
          tone="secondary"
          value="30s"
        />
        <MetricCard
          description="Queue round trip"
          icon={Server}
          label="Latency"
          tone="success"
          value="21ms"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader className="border-b border-linear-charcoal">
            <p className="font-mono text-[10px] font-medium uppercase text-linear-lime">
              Worker pool
            </p>
            <CardTitle className="tracking-[-0.15px]">Runtime nodes</CardTitle>
            <CardDescription>
              Local scheduler services and queue processors currently attached to Kestro.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid gap-3 md:grid-cols-3">
              {workers.map((worker) => (
                <div
                  className="rounded-md border border-linear-charcoal bg-linear-slate p-3 shadow-panel"
                  key={worker.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-linear-charcoal text-linear-lime">
                      <Server className="h-4 w-4" />
                    </span>
                    <Badge variant={worker.status === "online" ? "success" : "neutral"}>
                      {worker.status}
                    </Badge>
                  </div>
                  <p className="mt-4 font-semibold text-linear-porcelain">{worker.name}</p>
                  <p className="mt-1 text-sm text-linear-storm">{worker.role}</p>
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-linear-charcoal pt-3">
                    <MiniStat label="Load" value={worker.load} />
                    <MiniStat label="Latency" value={worker.latency} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-linear-charcoal">
            <p className="font-mono text-[10px] font-medium uppercase text-linear-lime">
              Queue health
            </p>
            <CardTitle className="tracking-[-0.15px]">Dispatch loop</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-0 border-y border-linear-charcoal pt-4">
            <DetailTile label="Worker" value="online" />
            <DetailTile label="Queue latency" value="21ms" />
            <DetailTile label="Tick interval" value="30s" />
            <DetailTile label="Retry backlog" value={`${failedRuns} failed runs`} />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function ApiView({
  apiBaseUrl,
  onCreateSchedule,
  onImportBruno
}: {
  apiBaseUrl: string;
  onCreateSchedule: () => void;
  onImportBruno: () => void;
}) {
  const endpoints = [
    {
      method: "GET",
      path: "/health",
      description: "Runtime readiness and service metadata."
    },
    {
      method: "GET",
      path: "/api/schedules",
      description: "List schedules from the database."
    },
    {
      method: "POST",
      path: "/api/imports/bruno/request",
      description: "Parse a Bruno request file into a schedule draft."
    },
    {
      method: "PATCH",
      path: "/api/schedules/:id",
      description: "Update schedule target, status, cron, and retry policy."
    },
    {
      method: "POST",
      path: "/api/schedules/:id/run",
      description: "Queue an immediate execution for a schedule."
    }
  ];

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
      <Card>
        <CardHeader className="border-b border-linear-charcoal">
          <p className="font-mono text-[10px] font-medium uppercase text-linear-lime">
            HTTP surface
          </p>
          <CardTitle className="tracking-[-0.15px]">API endpoints</CardTitle>
          <CardDescription>
            Local service base URL: <span className="font-mono text-linear-steel">{apiBaseUrl}</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="divide-y divide-linear-charcoal">
            {endpoints.map((endpoint) => (
              <div
                className="grid gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[100px_minmax(0,1fr)]"
                key={`${endpoint.method}-${endpoint.path}`}
              >
                <Badge className="w-fit font-mono" variant={endpoint.method === "GET" ? "neutral" : "default"}>
                  {endpoint.method}
                </Badge>
                <div className="min-w-0">
                  <p className="break-all font-mono text-sm text-linear-porcelain">
                    {endpoint.path}
                  </p>
                  <p className="mt-1 text-sm text-linear-storm">{endpoint.description}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader className="border-b border-linear-charcoal">
            <p className="font-mono text-[10px] font-medium uppercase text-linear-lime">
              Quick actions
            </p>
            <CardTitle className="tracking-[-0.15px]">Create from API inputs</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 pt-4">
            <Button onClick={onImportBruno} variant="outline">
              <Upload className="h-4 w-4" />
              Import Bruno request
            </Button>
            <Button onClick={onCreateSchedule}>
              <Plus className="h-4 w-4" />
              Create schedule
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b border-linear-charcoal">
            <p className="font-mono text-[10px] font-medium uppercase text-linear-lime">
              Example
            </p>
            <CardTitle className="tracking-[-0.15px]">Bruno import</CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <CodeBlock
              value={`curl -X POST ${apiBaseUrl}/api/imports/bruno/request \\\n  -F "file=@request.bru"`}
            />
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function ScheduleListItem({
  latestExecution,
  onDelete,
  onEdit,
  onRunNow,
  onSelect,
  onToggle,
  runNotice,
  runPending,
  schedule,
  selected
}: {
  latestExecution?: Execution;
  onDelete: () => void;
  onEdit: () => void;
  onRunNow: () => void;
  onSelect: () => void;
  onToggle: () => void;
  runNotice?: RunNotice;
  runPending: boolean;
  schedule: Schedule;
  selected: boolean;
}) {
  const latestFailed = latestExecution?.status === "failed";
  const successTone = latestFailed || schedule.successRate < 90 ? "danger" : "success";

  return (
    <div
      className={cn(
        "group cursor-pointer rounded-md border bg-linear-graphite p-3 transition-colors focus:outline-none focus:ring-2 focus:ring-linear-lime focus:ring-offset-2 focus:ring-offset-linear-black",
        runNotice?.status === "running" && "border-linear-lime/60 bg-linear-slate",
        selected
          ? "border-linear-lime/70 shadow-linear-inset"
          : "border-linear-charcoal hover:border-linear-ash hover:bg-linear-slate"
      )}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(210px,1fr)_minmax(112px,0.55fr)_minmax(120px,0.6fr)_minmax(88px,0.45fr)_auto] md:items-center min-[1700px]:grid-cols-[minmax(250px,1.35fr)_minmax(125px,0.72fr)_minmax(115px,0.65fr)_minmax(115px,0.65fr)_minmax(95px,0.5fr)_minmax(95px,0.5fr)_auto]">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
              selected ? "bg-linear-lime text-linear-black" : "bg-linear-charcoal text-linear-storm"
            )}
          >
            <CalendarClock className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold leading-5 text-linear-porcelain">{schedule.name}</p>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
              <Badge className="font-mono" variant="neutral">
                {schedule.method}
              </Badge>
              <span className="min-w-0 truncate font-mono text-xs text-linear-storm">
                {getEndpointHost(schedule.targetUrl)}
              </span>
              {runNotice ? <RunNoticeBadge notice={runNotice} /> : null}
            </div>
          </div>
        </div>

        <ScheduleDatum
          label="Schedule"
          meta={schedule.cronExpression}
          value={formatCronSummary(schedule.cronExpression)}
        />
        <ScheduleDatum
          label="Next run"
          meta={formatRelativeTime(schedule.nextRunAt)}
          value={formatDate(schedule.nextRunAt)}
        />
        <div className="hidden min-[1700px]:block">
          <ScheduleDatum
            label="Last run"
            meta={latestExecution?.status === "failed" ? "Last failed" : "Last execution"}
            value={formatRelativeTime(schedule.lastRunAt)}
          />
        </div>
        <ScheduleDatum
          label="Success"
          tone={successTone}
          value={`${schedule.successRate.toFixed(1)}%`}
        />
        <div className="hidden min-[1700px]:block">
          <ScheduleDatum
            label="Duration"
            meta={`Retries ${schedule.retryCount}`}
            value={formatDuration(latestExecution?.durationMs)}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 min-[1700px]:justify-end">
          <StatusBadge status={schedule.status} />
          <div className="flex gap-1">
            <IconButton
              disabled={runPending}
              label="Run now"
              onClick={(event) => {
                event.stopPropagation();
                onRunNow();
              }}
            >
              {runPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </IconButton>
            <IconButton
              label={schedule.status === "active" ? "Pause" : "Resume"}
              onClick={(event) => {
                event.stopPropagation();
                onToggle();
              }}
            >
              {schedule.status === "active" ? (
                <Pause className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4" />
              )}
            </IconButton>
            <IconButton
              label="Edit"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
            >
              <Edit3 className="h-4 w-4" />
            </IconButton>
            <IconButton
              label="Delete"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="h-4 w-4" />
            </IconButton>
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-3 border-t border-linear-charcoal pt-3 sm:grid-cols-3 min-[1700px]:hidden">
        <ScheduleDatum
          label="Last run"
          meta={latestExecution?.status === "failed" ? "Last failed" : "Last execution"}
          value={formatRelativeTime(schedule.lastRunAt)}
        />
        <ScheduleDatum
          label="Latest duration"
          meta={`Retries ${schedule.retryCount}`}
          value={formatDuration(latestExecution?.durationMs)}
        />
        <ScheduleDatum
          label="Timeout"
          value={`${schedule.timeoutSeconds}s`}
        />
      </div>
    </div>
  );
}

function ScheduleBuilder({
  onChange,
  value
}: {
  onChange: (value: string) => void;
  value: string;
}) {
  const [state, setState] = useState(() => parseScheduleBuilder(value));
  const expression = buildScheduleExpression(state);

  useEffect(() => {
    setState(parseScheduleBuilder(value));
  }, [value]);

  function commit(next: ScheduleBuilderState) {
    setState(next);
    onChange(buildScheduleExpression(next));
  }

  function setMode(mode: ScheduleBuilderMode) {
    commit({
      ...state,
      customExpression: state.customExpression || value || expression,
      mode
    });
  }

  function setNumber(
    key: "dayOfMonth" | "hour" | "intervalMinutes" | "minute",
    rawValue: string,
    min: number,
    max: number
  ) {
    commit({
      ...state,
      [key]: clampInteger(rawValue, min, max, state[key])
    });
  }

  return (
    <div className="space-y-3 rounded-md border border-linear-charcoal bg-linear-slate p-3">
      <div className="grid grid-cols-3 gap-1 lg:grid-cols-6">
        {scheduleModes.map((mode) => (
          <button
            className={cn(
              "h-8 rounded-sm px-2 text-xs font-medium transition-colors",
              state.mode === mode.value
                ? "bg-linear-lime text-linear-black"
                : "bg-linear-gunmetal text-linear-storm hover:bg-linear-charcoal hover:text-linear-porcelain"
            )}
            key={mode.value}
            onClick={() => setMode(mode.value)}
            type="button"
          >
            {mode.label}
          </button>
        ))}
      </div>

      {state.mode === "interval" ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <ScheduleNumberField
            label="Minutes"
            max={59}
            min={1}
            onChange={(nextValue) => setNumber("intervalMinutes", nextValue, 1, 59)}
            value={state.intervalMinutes}
          />
          <span className="pb-2 text-sm text-linear-storm">repeat</span>
        </div>
      ) : null}

      {state.mode === "hourly" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ScheduleNumberField
            label="Minute"
            max={59}
            min={0}
            onChange={(nextValue) => setNumber("minute", nextValue, 0, 59)}
            value={state.minute}
          />
        </div>
      ) : null}

      {state.mode === "daily" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ScheduleNumberField
            label="Hour"
            max={23}
            min={0}
            onChange={(nextValue) => setNumber("hour", nextValue, 0, 23)}
            value={state.hour}
          />
          <ScheduleNumberField
            label="Minute"
            max={59}
            min={0}
            onChange={(nextValue) => setNumber("minute", nextValue, 0, 59)}
            value={state.minute}
          />
        </div>
      ) : null}

      {state.mode === "weekly" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>Day</Label>
            <Select
              onValueChange={(nextValue) =>
                commit({
                  ...state,
                  dayOfWeek: nextValue
                })
              }
              value={state.dayOfWeek}
            >
              <SelectTrigger>
                <SelectValue placeholder="Day" />
              </SelectTrigger>
              <SelectContent>
                {weekdays.map((day) => (
                  <SelectItem key={day.value} value={day.value}>
                    {day.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ScheduleNumberField
            label="Hour"
            max={23}
            min={0}
            onChange={(nextValue) => setNumber("hour", nextValue, 0, 23)}
            value={state.hour}
          />
          <ScheduleNumberField
            label="Minute"
            max={59}
            min={0}
            onChange={(nextValue) => setNumber("minute", nextValue, 0, 59)}
            value={state.minute}
          />
        </div>
      ) : null}

      {state.mode === "monthly" ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <ScheduleNumberField
            label="Day"
            max={31}
            min={1}
            onChange={(nextValue) => setNumber("dayOfMonth", nextValue, 1, 31)}
            value={state.dayOfMonth}
          />
          <ScheduleNumberField
            label="Hour"
            max={23}
            min={0}
            onChange={(nextValue) => setNumber("hour", nextValue, 0, 23)}
            value={state.hour}
          />
          <ScheduleNumberField
            label="Minute"
            max={59}
            min={0}
            onChange={(nextValue) => setNumber("minute", nextValue, 0, 59)}
            value={state.minute}
          />
        </div>
      ) : null}

      {state.mode === "custom" ? (
        <div className="space-y-2">
          <Label>Cron</Label>
          <Input
            className="font-mono"
            onChange={(event) =>
              commit({
                ...state,
                customExpression: event.target.value
              })
            }
            placeholder="*/15 * * * *"
            value={state.customExpression}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-linear-charcoal bg-linear-black px-3 py-2">
        <span className="font-mono text-[10px] font-medium uppercase text-linear-fog">Cron</span>
        <code className="font-mono text-xs text-linear-steel">{expression}</code>
        <span className="text-xs text-linear-storm">{formatCronSummary(expression)}</span>
      </div>
    </div>
  );
}

function ScheduleNumberField({
  label,
  max,
  min,
  onChange,
  value
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: string) => void;
  value: number;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        inputMode="numeric"
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        type="number"
        value={value}
      />
    </div>
  );
}

function ScheduleDatum({
  label,
  meta,
  tone = "neutral",
  value
}: {
  label: string;
  meta?: string;
  tone?: "danger" | "neutral" | "success";
  value: string;
}) {
  const valueClass = {
    danger: "text-[#ff8585]",
    neutral: "text-linear-porcelain",
    success: "text-[#77df8d]"
  }[tone];

  return (
    <div className="min-w-0">
      <p className="font-mono text-[10px] font-medium uppercase text-linear-fog">{label}</p>
      <p className={cn("mt-1 text-sm font-semibold leading-5", valueClass)}>{value}</p>
      {meta ? <p className="mt-1 truncate text-xs text-linear-storm">{meta}</p> : null}
    </div>
  );
}

function RunNoticeBadge({ notice }: { notice: RunNotice }) {
  const toneClass = {
    failed: "border-linear-red/30 bg-linear-red/10 text-[#ff8585]",
    running: "border-linear-lime/30 bg-linear-lime/10 text-linear-lime",
    success: "border-linear-emerald/30 bg-linear-emerald/10 text-[#77df8d]"
  }[notice.status];

  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1 rounded-sm border px-2 font-mono text-[10px] font-medium uppercase",
        toneClass
      )}
    >
      {notice.status === "running" ? (
        <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />
      ) : null}
      <span className="truncate">{notice.message}</span>
    </span>
  );
}

function MetricCard({
  description,
  icon: Icon,
  label,
  tone,
  value
}: {
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tone: "danger" | "dark" | "primary" | "secondary" | "success";
  value: string;
}) {
  const toneClass = {
    danger: {
      accent: "bg-linear-red",
      card: "border-linear-red/30 bg-linear-red/10",
      description: "text-linear-storm",
      icon: "bg-linear-red/15 text-[#ff8585]",
      label: "text-[#ff8585]",
      value: "text-[#ff8585]"
    },
    dark: {
      accent: "bg-linear-lime",
      card: "border-linear-charcoal bg-linear-slate",
      description: "text-linear-storm",
      icon: "bg-linear-charcoal text-linear-steel",
      label: "text-linear-lime",
      value: "text-linear-porcelain"
    },
    primary: {
      accent: "bg-linear-lime",
      card: "border-linear-charcoal bg-linear-graphite",
      description: "text-linear-storm",
      icon: "bg-linear-charcoal text-linear-lime",
      label: "text-linear-storm",
      value: "text-linear-porcelain"
    },
    secondary: {
      accent: "bg-linear-ash",
      card: "border-linear-charcoal bg-linear-graphite",
      description: "text-linear-storm",
      icon: "bg-linear-charcoal text-linear-steel",
      label: "text-linear-storm",
      value: "text-linear-porcelain"
    },
    success: {
      accent: "bg-linear-emerald",
      card: "border-linear-emerald/30 bg-linear-emerald/10",
      description: "text-linear-storm",
      icon: "bg-linear-emerald/15 text-[#77df8d]",
      label: "text-[#77df8d]",
      value: "text-[#77df8d]"
    }
  }[tone];

  return (
    <Card className={cn("relative overflow-hidden", toneClass.card)}>
      <span className={cn("absolute inset-y-0 left-0 w-1", toneClass.accent)} />
      <CardContent className="flex min-h-[104px] items-start justify-between gap-4 p-4 pl-5">
        <div className="min-w-0">
          <p className={cn("font-mono text-[10px] font-medium uppercase", toneClass.label)}>
            {label}
          </p>
          <p className={cn("mt-2 truncate text-[24px] font-semibold leading-7 tracking-[-0.15px]", toneClass.value)}>
            {value}
          </p>
          <p className={cn("mt-1 line-clamp-1 text-sm", toneClass.description)}>
            {description}
          </p>
        </div>
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
            toneClass.icon
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 border-t border-linear-charcoal pt-3">
      <p className="font-mono text-[10px] font-medium uppercase text-linear-fog">{label}</p>
      <p className="mt-1 truncate font-mono text-sm text-linear-porcelain">{value}</p>
    </div>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-20 border-b border-linear-charcoal py-3 odd:pr-4 even:border-l even:border-linear-charcoal even:pl-4 [&:nth-last-child(-n+2)]:border-b-0">
      <p className="font-mono text-[10px] font-medium uppercase text-linear-fog">{label}</p>
      <p className="mt-2 text-sm font-semibold text-linear-porcelain">{value}</p>
    </div>
  );
}

function CodeBlock({ value }: { value: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-linear-charcoal bg-linear-black p-3 font-mono text-xs leading-5 text-linear-steel">
      <code>{value}</code>
    </pre>
  );
}

function Field({
  children,
  error,
  label
}: {
  children: React.ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs font-medium text-[#ff8585]">{error}</p> : null}
    </div>
  );
}

function IconButton({
  children,
  disabled = false,
  label,
  onClick
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Button
      aria-label={label}
      className="h-8 w-8"
      disabled={disabled}
      onClick={onClick}
      size="icon"
      variant="ghost"
    >
      {children}
    </Button>
  );
}

function StatusBadge({ status }: { status: ScheduleStatus }) {
  return (
    <Badge variant={status === "active" ? "success" : "neutral"}>
      {status === "active" ? "Active" : "Paused"}
    </Badge>
  );
}

function ExecutionBadge({ status }: { status: ExecutionStatus }) {
  return (
    <Badge variant={status === "success" ? "success" : "danger"}>
      {status === "success" ? "Success" : "Failed"}
    </Badge>
  );
}

async function fetchSchedules() {
  const schedules = await requestApi<ApiSchedule[]>("/api/schedules");
  return schedules.map(normalizeApiSchedule);
}

async function fetchExecutionsForSchedules(scheduleIds: string[]) {
  if (!scheduleIds.length) {
    return [];
  }

  const executionGroups = await Promise.all(
    scheduleIds.map((scheduleId) =>
      requestApi<ApiExecution[]>(`/api/schedules/${scheduleId}/executions`)
    )
  );

  return executionGroups
    .flat()
    .map(normalizeApiExecution)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

async function createSchedule(payload: ScheduleRequest) {
  const schedule = await requestApi<ApiSchedule>("/api/schedules", {
    body: JSON.stringify(payload),
    method: "POST"
  });

  return normalizeApiSchedule(schedule);
}

async function updateSchedule(scheduleId: string, payload: ScheduleRequest) {
  const schedule = await requestApi<ApiSchedule>(`/api/schedules/${scheduleId}`, {
    body: JSON.stringify(payload),
    method: "PATCH"
  });

  return normalizeApiSchedule(schedule);
}

async function removeSchedule(scheduleId: string) {
  await requestApi<void>(`/api/schedules/${scheduleId}`, {
    method: "DELETE"
  });
}

async function runScheduleNow(scheduleId: string) {
  const execution = await requestApi<ApiExecution>(`/api/schedules/${scheduleId}/run`, {
    method: "POST"
  });

  return normalizeApiExecution(execution);
}

async function requestApi<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

async function readApiError(response: Response) {
  let message = `HTTP ${response.status}`;

  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      message = payload.error;
    }
  } catch {
    // Keep the status message when the API did not return a JSON error payload.
  }

  return message;
}

function normalizeApiSchedule(schedule: ApiSchedule): Schedule {
  return {
    id: schedule.id,
    name: schedule.name,
    targetUrl: schedule.targetUrl,
    method: normalizeApiMethod(schedule.method),
    cronExpression: schedule.cronExpression,
    status: normalizeApiStatus(schedule.status),
    nextRunAt: schedule.nextRunAt,
    lastRunAt: "Never",
    successRate: 0,
    timeoutSeconds: schedule.timeoutSeconds,
    retryCount: schedule.retryCount,
    headers: stringifyApiHeaders(schedule.headers),
    payload: schedule.payload ?? ""
  };
}

function normalizeApiExecution(execution: ApiExecution): Execution {
  return {
    id: execution.id,
    scheduleId: execution.scheduleId,
    timestamp: execution.startedAt,
    status: normalizeApiExecutionStatus(execution.status),
    durationMs: execution.durationMs,
    statusCode: execution.statusCode ?? undefined,
    error: execution.error ?? undefined
  };
}

function enrichSchedulesWithExecutions(schedules: Schedule[], executions: Execution[]) {
  const executionsBySchedule = new Map<string, Execution[]>();

  executions.forEach((execution) => {
    const scheduleExecutions = executionsBySchedule.get(execution.scheduleId) ?? [];
    scheduleExecutions.push(execution);
    executionsBySchedule.set(execution.scheduleId, scheduleExecutions);
  });

  return schedules.map((schedule) => {
    const scheduleExecutions = executionsBySchedule.get(schedule.id) ?? [];
    const successCount = scheduleExecutions.filter(
      (execution) => execution.status === "success"
    ).length;

    return {
      ...schedule,
      lastRunAt: scheduleExecutions[0]?.timestamp ?? "Never",
      successRate: scheduleExecutions.length
        ? (successCount / scheduleExecutions.length) * 100
        : 0
    };
  });
}

function buildScheduleRequest(values: ScheduleFormValues): ScheduleRequest {
  return {
    name: values.name,
    targetUrl: values.targetUrl,
    method: values.method,
    cronExpression: values.cronExpression,
    headers: parseHeaders(values.headers),
    payload: values.payload ?? "",
    status: values.status,
    timeoutSeconds: values.timeoutSeconds,
    retryCount: values.retryCount
  };
}

function parseHeaders(value?: string) {
  if (!value?.trim()) {
    return {};
  }

  return JSON.parse(value) as Record<string, unknown>;
}

function stringifyApiHeaders(headers: unknown) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return "{}";
  }

  return JSON.stringify(headers, null, 2);
}

function normalizeApiMethod(method: string): HttpMethod {
  const normalized = method.trim().toUpperCase();
  return methods.includes(normalized as HttpMethod) ? (normalized as HttpMethod) : "GET";
}

function normalizeApiStatus(status: string): ScheduleStatus {
  return status === "paused" ? "paused" : "active";
}

function normalizeApiExecutionStatus(status: string): ExecutionStatus {
  return status === "success" ? "success" : "failed";
}

function getErrorMessage(error: unknown) {
  if (!error) {
    return null;
  }

  return error instanceof Error ? error.message : "Unexpected API error.";
}

function parseScheduleBuilder(expression: string): ScheduleBuilderState {
  const base: ScheduleBuilderState = {
    customExpression: expression || "*/15 * * * *",
    dayOfMonth: 1,
    dayOfWeek: "1",
    hour: 9,
    intervalMinutes: 15,
    minute: 0,
    mode: "interval"
  };
  const parts = getFivePartCron(expression);

  if (!parts) {
    return {
      ...base,
      customExpression: expression,
      mode: "custom"
    };
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (
    minute.startsWith("*/") &&
    isIntegerString(minute.slice(2)) &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return {
      ...base,
      intervalMinutes: clampInteger(minute.slice(2), 1, 59, base.intervalMinutes),
      mode: "interval"
    };
  }

  if (
    isIntegerString(minute) &&
    hour === "*" &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return {
      ...base,
      minute: clampInteger(minute, 0, 59, base.minute),
      mode: "hourly"
    };
  }

  if (
    isIntegerString(minute) &&
    isIntegerString(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return {
      ...base,
      hour: clampInteger(hour, 0, 23, base.hour),
      minute: clampInteger(minute, 0, 59, base.minute),
      mode: "daily"
    };
  }

  if (
    isIntegerString(minute) &&
    isIntegerString(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    weekdays.some((day) => day.value === dayOfWeek)
  ) {
    return {
      ...base,
      dayOfWeek,
      hour: clampInteger(hour, 0, 23, base.hour),
      minute: clampInteger(minute, 0, 59, base.minute),
      mode: "weekly"
    };
  }

  if (
    isIntegerString(minute) &&
    isIntegerString(hour) &&
    isIntegerString(dayOfMonth) &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return {
      ...base,
      dayOfMonth: clampInteger(dayOfMonth, 1, 31, base.dayOfMonth),
      hour: clampInteger(hour, 0, 23, base.hour),
      minute: clampInteger(minute, 0, 59, base.minute),
      mode: "monthly"
    };
  }

  return {
    ...base,
    customExpression: expression,
    mode: "custom"
  };
}

function buildScheduleExpression(state: ScheduleBuilderState) {
  const minute = clampInteger(state.minute, 0, 59, 0);
  const hour = clampInteger(state.hour, 0, 23, 9);

  switch (state.mode) {
    case "interval":
      return `*/${clampInteger(state.intervalMinutes, 1, 59, 15)} * * * *`;
    case "hourly":
      return `${minute} * * * *`;
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekly":
      return `${minute} ${hour} * * ${state.dayOfWeek}`;
    case "monthly":
      return `${minute} ${hour} ${clampInteger(state.dayOfMonth, 1, 31, 1)} * *`;
    case "custom":
      return state.customExpression.trim() || "*/15 * * * *";
  }
}

function getFivePartCron(expression: string) {
  const parts = expression.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 5) {
    return parts;
  }

  if (parts.length === 6 && parts[0] === "0") {
    return parts.slice(1);
  }

  return null;
}

function isIntegerString(value: string) {
  return /^\d+$/.test(value);
}

function clampInteger(
  value: number | string,
  min: number,
  max: number,
  fallback: number
) {
  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function getFormDefaults(schedule?: Schedule): ScheduleFormInput {
  return {
    name: schedule?.name ?? "",
    targetUrl: schedule?.targetUrl ?? "",
    method: schedule?.method ?? "POST",
    cronExpression: schedule?.cronExpression ?? "*/15 * * * *",
    status: schedule?.status ?? "active",
    headers: schedule?.headers ?? "{\n  \"Content-Type\": \"application/json\"\n}",
    payload: schedule?.payload ?? "",
    timeoutSeconds: schedule?.timeoutSeconds ?? 30,
    retryCount: schedule?.retryCount ?? 2
  };
}

function getBrunoFormDefaults(draft: BrunoImportPreview["schedule"]): ScheduleFormInput {
  const method = normalizeImportedMethod(draft.method);
  const status: ScheduleStatus = draft.status === "active" ? "active" : "paused";

  return {
    name: draft.name,
    targetUrl: draft.targetUrl,
    method,
    cronExpression: draft.cronExpression || "0 * * * *",
    status,
    headers: stringifyImportedHeaders(draft.headers),
    payload: draft.payload ?? "",
    timeoutSeconds: draft.timeoutSeconds ?? 30,
    retryCount: draft.retryCount ?? 0
  };
}

function normalizeImportedMethod(method: string): HttpMethod {
  const normalized = method.trim().toUpperCase();
  return methods.includes(normalized as HttpMethod) ? (normalized as HttpMethod) : "GET";
}

function stringifyImportedHeaders(headers: unknown) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return "{}";
  }

  return JSON.stringify(headers, null, 2);
}

function buildImportWarnings(preview: BrunoImportPreview) {
  const warnings = new Set(preview.warnings);

  if (!methods.includes(preview.schedule.method.toUpperCase() as HttpMethod)) {
    warnings.add(`Method ${preview.schedule.method} is not supported in the form; defaulted to GET.`);
  }

  if (preview.unsupportedBlocks.length > 0) {
    warnings.add(`Unsupported Bruno blocks: ${preview.unsupportedBlocks.join(", ")}.`);
  }

  return Array.from(warnings);
}

function isJsonObjectOrEmpty(value?: string) {
  if (!value?.trim()) {
    return true;
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function formatDate(value: string) {
  if (value === "Never") {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-AU", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-AU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatRelativeTime(value: string) {
  if (value === "Never") {
    return value;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const diffMs = date.getTime() - Date.now();
  const absMs = Math.abs(diffMs);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000]
  ];
  const fallback: [Intl.RelativeTimeFormatUnit, number] = ["second", 1_000];
  const [unit, unitMs] = units.find(([, threshold]) => absMs >= threshold) ?? fallback;
  const amount = Math.round(diffMs / unitMs);

  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(amount, unit);
}

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) {
    return "No runs";
  }

  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatCronSummary(expression: string) {
  const parts = getFivePartCron(expression);

  if (!parts) {
    return expression;
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (minute.startsWith("*/") && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const minutes = Number(minute.slice(2));
    return Number.isFinite(minutes) ? `Every ${minutes} mins` : expression;
  }

  if (minute === "0" && hour.startsWith("*/") && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    const hours = Number(hour.slice(2));
    return Number.isFinite(hours) ? `Every ${hours} hours` : expression;
  }

  if (hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && /^\d+$/.test(minute)) {
    return `Hourly at :${minute.padStart(2, "0")}`;
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === "*" && month === "*" && dayOfWeek === "1-5") {
    return `Weekdays at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }

  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    dayOfMonth === "*" &&
    month === "*" &&
    weekdays.some((day) => day.value === dayOfWeek)
  ) {
    const day = weekdays.find((item) => item.value === dayOfWeek)?.label ?? dayOfWeek;
    return `${day} at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }

  if (
    /^\d+$/.test(minute) &&
    /^\d+$/.test(hour) &&
    /^\d+$/.test(dayOfMonth) &&
    month === "*" &&
    dayOfWeek === "*"
  ) {
    return `Monthly day ${dayOfMonth} at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }

  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return `Daily at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }

  return expression;
}

function getEndpointHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0] || value;
  }
}
