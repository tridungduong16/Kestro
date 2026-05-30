"use client";

import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Code2,
  Edit3,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Server,
  Timer,
  Trash2,
  XCircle
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { executions as mockExecutions, schedules as mockSchedules } from "@/lib/mock-data";
import type {
  Execution,
  ExecutionStatus,
  HttpMethod,
  Schedule,
  ScheduleStatus
} from "@/lib/types";

const methods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const statuses = ["active", "paused"] as const;
const emptySchedules: Schedule[] = [];
const emptyExecutions: Execution[] = [];

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
  payload: z
    .string()
    .optional()
    .refine((value) => isJsonOrEmpty(value), "Payload must be valid JSON."),
  timeoutSeconds: z.coerce.number().min(1).max(120),
  retryCount: z.coerce.number().min(0).max(5)
});

type ScheduleFormInput = z.input<typeof scheduleSchema>;
type ScheduleFormValues = z.output<typeof scheduleSchema>;

const scheduleQueryKey = ["schedules"];
const executionQueryKey = ["executions"];

export function SchedulerDashboard() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState(mockSchedules[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);

  const schedulesQuery = useQuery({
    queryKey: scheduleQueryKey,
    queryFn: async () => mockSchedules
  });

  const executionsQuery = useQuery({
    queryKey: executionQueryKey,
    queryFn: async () => mockExecutions
  });

  const schedules = schedulesQuery.data ?? emptySchedules;
  const executions = executionsQuery.data ?? emptyExecutions;
  const selectedSchedule = schedules.find((schedule) => schedule.id === selectedId) ?? schedules[0];
  const selectedExecutions = executions
    .filter((execution) => execution.scheduleId === selectedSchedule?.id)
    .slice(0, 8);

  useEffect(() => {
    if (!schedules.length) {
      setSelectedId("");
      return;
    }

    if (!schedules.some((schedule) => schedule.id === selectedId)) {
      setSelectedId(schedules[0].id);
    }
  }, [schedules, selectedId]);

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
      await wait(250);

      const schedule: Schedule = {
        id: editingSchedule?.id ?? `sch_${crypto.randomUUID().slice(0, 8)}`,
        name: values.name,
        targetUrl: values.targetUrl,
        method: values.method,
        cronExpression: values.cronExpression,
        status: values.status,
        nextRunAt: editingSchedule?.nextRunAt ?? nextRunInMinutes(15),
        lastRunAt: editingSchedule?.lastRunAt ?? "Never",
        successRate: editingSchedule?.successRate ?? 100,
        timeoutSeconds: values.timeoutSeconds,
        retryCount: values.retryCount,
        headers: values.headers ?? "",
        payload: values.payload ?? ""
      };

      return schedule;
    },
    onSuccess: (schedule) => {
      queryClient.setQueryData<Schedule[]>(scheduleQueryKey, (current = []) => {
        const exists = current.some((item) => item.id === schedule.id);
        if (exists) {
          return current.map((item) => (item.id === schedule.id ? schedule : item));
        }
        return [schedule, ...current];
      });
      setSelectedId(schedule.id);
      setDialogOpen(false);
      setEditingSchedule(null);
      form.reset(getFormDefaults());
    }
  });

  const runNow = useMutation({
    mutationFn: async (schedule: Schedule) => {
      await wait(450);
      const successful = schedule.status === "active" && schedule.successRate >= 90;
      const execution: Execution = {
        id: `exe_${crypto.randomUUID().slice(0, 8)}`,
        scheduleId: schedule.id,
        timestamp: new Date().toISOString(),
        status: successful ? "success" : "failed",
        durationMs: successful ? 240 + Math.round(Math.random() * 900) : schedule.timeoutSeconds * 1000,
        statusCode: successful ? 200 : undefined,
        error: successful ? undefined : "Endpoint did not return a successful response."
      };
      return execution;
    },
    onSuccess: (execution) => {
      queryClient.setQueryData<Execution[]>(executionQueryKey, (current = []) => [
        execution,
        ...current
      ]);
      queryClient.setQueryData<Schedule[]>(scheduleQueryKey, (current = []) =>
        current.map((schedule) =>
          schedule.id === execution.scheduleId
            ? {
                ...schedule,
                lastRunAt: execution.timestamp,
                successRate:
                  execution.status === "success"
                    ? Math.min(100, schedule.successRate + 0.2)
                    : Math.max(0, schedule.successRate - 2.5)
              }
            : schedule
        )
      );
    }
  });

  const toggleSchedule = useMutation({
    mutationFn: async (schedule: Schedule) => {
      await wait(150);
      const nextStatus: ScheduleStatus =
        schedule.status === "active" ? "paused" : "active";
      return { ...schedule, status: nextStatus };
    },
    onSuccess: (schedule) => {
      queryClient.setQueryData<Schedule[]>(scheduleQueryKey, (current = []) =>
        current.map((item) => (item.id === schedule.id ? schedule : item))
      );
    }
  });

  const deleteSchedule = useMutation({
    mutationFn: async (schedule: Schedule) => {
      await wait(150);
      return schedule.id;
    },
    onSuccess: (scheduleId) => {
      queryClient.setQueryData<Schedule[]>(scheduleQueryKey, (current = []) =>
        current.filter((schedule) => schedule.id !== scheduleId)
      );
      queryClient.setQueryData<Execution[]>(executionQueryKey, (current = []) =>
        current.filter((execution) => execution.scheduleId !== scheduleId)
      );
    }
  });

  function openCreateDialog() {
    setEditingSchedule(null);
    form.reset(getFormDefaults());
    setDialogOpen(true);
  }

  function openEditDialog(schedule: Schedule) {
    setEditingSchedule(schedule);
    form.reset(getFormDefaults(schedule));
    setDialogOpen(true);
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(6,182,212,0.11),transparent_30%),#F8FAFC]">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 flex-col border-r border-white/10 bg-surface text-white lg:flex">
        <div className="flex h-20 items-center gap-3 px-6">
          <Image
            alt=""
            className="h-10 w-10 rounded-xl object-cover"
            height={40}
            priority
            src="/logo.png"
            width={40}
          />
          <div>
            <p className="text-lg font-semibold">Chronos</p>
            <p className="font-mono text-xs text-slate-400">HTTP scheduler</p>
          </div>
        </div>
        <nav className="space-y-1 px-3">
          {[
            { icon: Activity, label: "Schedules", active: true },
            { icon: Clock3, label: "History" },
            { icon: Server, label: "Workers" },
            { icon: Code2, label: "API" }
          ].map((item) => (
            <button
              className={cn(
                "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm transition-colors",
                item.active
                  ? "bg-white text-slate-950"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              )}
              key={item.label}
              type="button"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="mt-auto p-4">
          <div className="rounded-2xl border border-white/10 bg-white/[0.08] p-4">
            <div className="flex items-center justify-between">
              <Badge variant="dark">Worker online</Badge>
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </div>
            <div className="mt-5 grid grid-cols-7 items-end gap-1.5">
              {[42, 58, 64, 46, 72, 61, 80].map((height, index) => (
                <span
                  className="rounded-sm bg-chronos-cyan/80"
                  key={`${height}-${index}`}
                  style={{ height }}
                />
              ))}
            </div>
            <p className="mt-4 font-mono text-xs text-slate-400">Queue latency 21ms</p>
          </div>
        </div>
      </aside>

      <section className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
          <div className="flex min-h-20 flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <div className="flex items-center gap-2 lg:hidden">
                <Image
                  alt=""
                  className="h-9 w-9 rounded-xl object-cover"
                  height={36}
                  priority
                  src="/logo.png"
                  width={36}
                />
                <p className="text-lg font-semibold">Chronos</p>
              </div>
              <h1 className="mt-2 text-2xl font-semibold text-slate-950 lg:mt-0">
                Schedule Management
              </h1>
              <p className="text-sm text-slate-500">
                Recurring HTTP jobs, execution visibility, and manual run controls.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="h-10 w-full pl-9 sm:w-72"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search schedules"
                  value={search}
                />
              </div>
              <Button onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                New schedule
              </Button>
            </div>
          </div>
        </header>

        <div className="space-y-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              description="Active schedules"
              icon={Activity}
              label="Live jobs"
              tone="cyan"
              value={stats.active.toString()}
            />
            <MetricCard
              description="Average over configured jobs"
              icon={CheckCircle2}
              label="Success rate"
              tone="emerald"
              value={`${stats.avgSuccess.toFixed(1)}%`}
            />
            <MetricCard
              description={stats.nextRun ? stats.nextRun.name : "No active jobs"}
              icon={Timer}
              label="Next run"
              tone="violet"
              value={stats.nextRun ? formatDate(stats.nextRun.nextRunAt) : "None"}
            />
            <MetricCard
              description="Needs attention"
              icon={AlertTriangle}
              label="Failed runs"
              tone="amber"
              value={stats.failedRuns.toString()}
            />
          </section>

          <section className="grid gap-6 min-[1800px]:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.9fr)]">
            <Card className="min-w-0 overflow-hidden">
              <CardHeader className="flex flex-col gap-3 border-b border-slate-200 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Schedules</CardTitle>
                  <CardDescription>
                    {filteredSchedules.length} jobs configured for HTTP execution
                  </CardDescription>
                </div>
                <Button
                  disabled={schedulesQuery.isFetching}
                  onClick={() => schedulesQuery.refetch()}
                  size="sm"
                  variant="outline"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] table-fixed text-left text-sm">
                    <colgroup>
                      <col className="w-[23%]" />
                      <col className="w-[29%]" />
                      <col className="w-[13%]" />
                      <col className="w-[16%]" />
                      <col className="w-[9%]" />
                      <col className="w-[10%]" />
                    </colgroup>
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Name</th>
                        <th className="px-5 py-3 font-semibold">Endpoint</th>
                        <th className="px-5 py-3 font-semibold">Cron</th>
                        <th className="px-5 py-3 font-semibold">Next run</th>
                        <th className="px-5 py-3 font-semibold">Status</th>
                        <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredSchedules.map((schedule) => (
                        <tr
                          className={cn(
                            "cursor-pointer transition-colors hover:bg-cyan-50/50 focus:bg-cyan-50/60 focus:outline-none",
                            selectedSchedule?.id === schedule.id && "bg-cyan-50/80"
                          )}
                          key={schedule.id}
                          onClick={() => setSelectedId(schedule.id)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              setSelectedId(schedule.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <td className="whitespace-nowrap px-5 py-4">
                            <div className="flex items-center gap-3">
                              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                                <CalendarClock className="h-4 w-4" />
                              </span>
                              <div>
                                <p className="font-medium text-slate-950">{schedule.name}</p>
                                <p className="font-mono text-xs text-slate-500">
                                  {schedule.method}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="max-w-[260px] px-5 py-4">
                            <p className="truncate font-mono text-xs text-slate-600">
                              {schedule.targetUrl}
                            </p>
                          </td>
                          <td className="whitespace-nowrap px-5 py-4">
                            <Badge variant="neutral">{schedule.cronExpression}</Badge>
                          </td>
                          <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                            {formatDate(schedule.nextRunAt)}
                          </td>
                          <td className="px-5 py-4">
                            <StatusBadge status={schedule.status} />
                          </td>
                          <td className="px-3 py-4">
                            <div className="flex justify-end gap-1">
                              <IconButton
                                label="Run now"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  runNow.mutate(schedule);
                                }}
                              >
                                <Play className="h-4 w-4" />
                              </IconButton>
                              <IconButton
                                label={schedule.status === "active" ? "Pause" : "Resume"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  toggleSchedule.mutate(schedule);
                                }}
                              >
                                {schedule.status === "active" ? (
                                  <Pause className="h-4 w-4" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </IconButton>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="border-b border-slate-200">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle>{selectedSchedule?.name ?? "No schedule selected"}</CardTitle>
                    <CardDescription>
                      {selectedSchedule
                        ? selectedSchedule.targetUrl
                        : "Create a schedule to see execution details."}
                    </CardDescription>
                  </div>
                  {selectedSchedule ? <StatusBadge status={selectedSchedule.status} /> : null}
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                {selectedSchedule ? (
                  <Tabs defaultValue="overview">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="overview">Overview</TabsTrigger>
                      <TabsTrigger value="history">History</TabsTrigger>
                    </TabsList>
                    <TabsContent value="overview">
                      <div className="space-y-5">
                        <EndpointPreview schedule={selectedSchedule} />
                        <div className="grid grid-cols-2 gap-3">
                          <DetailTile label="Next run" value={formatDate(selectedSchedule.nextRunAt)} />
                          <DetailTile label="Last run" value={formatDate(selectedSchedule.lastRunAt)} />
                          <DetailTile label="Timeout" value={`${selectedSchedule.timeoutSeconds}s`} />
                          <DetailTile label="Retries" value={selectedSchedule.retryCount.toString()} />
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          <Button
                            disabled={runNow.isPending}
                            onClick={() => runNow.mutate(selectedSchedule)}
                          >
                            <Play className="h-4 w-4" />
                            Run now
                          </Button>
                          <Button
                            onClick={() => openEditDialog(selectedSchedule)}
                            variant="outline"
                          >
                            <Edit3 className="h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            onClick={() => deleteSchedule.mutate(selectedSchedule)}
                            variant="outline"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="history">
                      <ExecutionList executions={selectedExecutions} />
                    </TabsContent>
                  </Tabs>
                ) : (
                  <div className="flex min-h-72 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
                    No schedules yet
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </div>
      </section>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSchedule ? "Edit schedule" : "Create schedule"}</DialogTitle>
            <DialogDescription>
              Configure the HTTP target, cron expression, retry policy, and request body.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-5"
            onSubmit={form.handleSubmit((values) => upsertSchedule.mutate(values))}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Schedule name" error={form.formState.errors.name?.message}>
                <Input placeholder="Billing reconciliation" {...form.register("name")} />
              </Field>
              <Field label="Cron expression" error={form.formState.errors.cronExpression?.message}>
                <Input
                  className="font-mono"
                  placeholder="*/15 * * * *"
                  {...form.register("cronExpression")}
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
                <label className="flex h-10 w-full items-center justify-between rounded-lg border border-slate-200 px-3 text-sm">
                  <span className="font-medium text-slate-700">Active</span>
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
                onClick={() => setDialogOpen(false)}
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
  tone: "cyan" | "emerald" | "violet" | "amber";
  value: string;
}) {
  const toneClass = {
    cyan: "bg-cyan-50 text-cyan-700",
    emerald: "bg-emerald-50 text-emerald-700",
    violet: "bg-violet-50 text-violet-700",
    amber: "bg-amber-50 text-amber-700"
  }[tone];

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{value}</p>
          <p className="mt-1 line-clamp-1 text-sm text-slate-500">{description}</p>
        </div>
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", toneClass)}>
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  );
}

function EndpointPreview({ schedule }: { schedule: Schedule }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <Badge variant="dark">{schedule.method}</Badge>
        <p className="font-mono text-xs text-slate-400">{schedule.cronExpression}</p>
      </div>
      <p className="mt-4 break-all font-mono text-sm text-cyan-200">
        {schedule.targetUrl}
      </p>
      <div className="mt-5 grid grid-cols-3 gap-2">
        <MiniStat label="Success" value={`${schedule.successRate.toFixed(1)}%`} />
        <MiniStat label="Timeout" value={`${schedule.timeoutSeconds}s`} />
        <MiniStat label="Retries" value={schedule.retryCount.toString()} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.08] p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-sm text-white">{value}</p>
    </div>
  );
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-h-20 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ExecutionList({ executions }: { executions: Execution[] }) {
  if (!executions.length) {
    return (
      <div className="flex min-h-60 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-sm text-slate-500">
        No executions recorded
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {executions.map((execution) => (
        <div
          className="flex gap-3 rounded-xl border border-slate-200 bg-white p-3"
          key={execution.id}
        >
          <span
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
              execution.status === "success"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-red-50 text-red-700"
            )}
          >
            {execution.status === "success" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium text-slate-950">
                  {execution.status === "success" ? "Completed" : "Failed"}
                </p>
                <p className="text-xs text-slate-500">{formatDate(execution.timestamp)}</p>
              </div>
              <ExecutionBadge status={execution.status} />
            </div>
            <p className="mt-2 font-mono text-xs text-slate-500">
              {execution.statusCode ? `HTTP ${execution.statusCode}` : execution.error} ·{" "}
              {execution.durationMs}ms
            </p>
          </div>
        </div>
      ))}
    </div>
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
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  );
}

function IconButton({
  children,
  label,
  onClick
}: {
  children: React.ReactNode;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Button
      aria-label={label}
      className="h-8 w-8"
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

function isJsonOrEmpty(value?: string) {
  if (!value?.trim()) {
    return true;
  }

  try {
    JSON.parse(value);
    return true;
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

function nextRunInMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
