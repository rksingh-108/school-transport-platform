'use client';

import { useState } from 'react';
import { ShieldAlert, Siren, CheckCircle2, XCircle, Clock, TrendingUp, ScanEye } from 'lucide-react';
import { getSafetyAnalytics } from '@/lib/api/safety-analytics';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Input } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { BarChart } from '@/components/ui/bar-chart';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { StatCardSkeleton } from '@/components/ui/skeleton';
import { ErrorState, EmptyState } from '@/components/ui/states';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export default function SafetyAnalyticsPage() {
  const [from, setFrom] = useState(isoDaysAgo(30).slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const { data, error, loading, reload } = useAsync(
    () => getSafetyAnalytics({ from: new Date(from).toISOString(), to: new Date(to + 'T23:59:59').toISOString() }),
    [from, to],
  );

  return (
    <div>
      <PageHeader
        title="Safety Analytics"
        description="Aggregated operational trends across AI observations, safety events, and emergencies — never raw detection rows."
        actions={
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2">
              From
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex items-center gap-2">
              To
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        }
      />

      {loading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <StatCardSkeleton key={i} />
          ))}
        </div>
      )}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load analytics — the date range may exceed 90 days.'} onRetry={reload} />
      )}
      {!loading && !error && data && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="AI observations" value={data.summary.totalObservations} icon={ScanEye} tone="info" />
            <StatCard label="Promoted" value={data.summary.promoted} icon={CheckCircle2} tone="success" />
            <StatCard label="Dismissed" value={data.summary.dismissed} icon={XCircle} tone="neutral" />
            <StatCard label="Pending review" value={data.summary.pendingReview} icon={Clock} tone="warning" />
            <StatCard label="Safety events" value={data.summary.totalSafetyEvents} icon={ShieldAlert} tone="warning" />
            <StatCard label="Emergencies" value={data.summary.totalEmergencies} icon={Siren} tone="danger" />
            <StatCard
              label="Promotion rate"
              value={data.summary.promotionRate !== null ? `${(data.summary.promotionRate * 100).toFixed(0)}%` : '—'}
              icon={TrendingUp}
              tone="brand"
            />
            <StatCard
              label="Avg. review time"
              value={data.summary.averageReviewTimeSeconds !== null ? `${Math.round(data.summary.averageReviewTimeSeconds / 60)}m` : '—'}
              icon={Clock}
              tone="neutral"
            />
          </div>
          <p className="text-xs text-(--color-text-faint)">
            &ldquo;Promotion rate&rdquo; reflects how often staff chose to promote a reviewed detection — it is not a measure of model accuracy, since human review is not a scientific ground-truth evaluation.
          </p>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Observations by detection type" />
              <CardBody>
                {data.observationsByDetectionType.length === 0 ? (
                  <EmptyState title="No observations in this range" />
                ) : (
                  <BarChart
                    rows={data.observationsByDetectionType.map((r) => ({ label: r.detectionType.replace(/_/g, ' '), value: r.count, tone: 'info' }))}
                  />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Safety events by severity" />
              <CardBody>
                {data.safetyEventsBySeverity.length === 0 ? (
                  <EmptyState title="No safety events in this range" />
                ) : (
                  <BarChart
                    rows={data.safetyEventsBySeverity.map((r) => ({
                      label: r.severity,
                      value: r.count,
                      tone: r.severity === 'CRITICAL' ? 'danger' : r.severity === 'HIGH' ? 'warning' : 'neutral',
                    }))}
                  />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Emergencies by status" />
              <CardBody>
                {data.emergenciesByStatus.length === 0 ? (
                  <EmptyState title="No emergencies in this range" />
                ) : (
                  <BarChart rows={data.emergenciesByStatus.map((r) => ({ label: r.status, value: r.count, tone: r.status === 'ACTIVE' ? 'danger' : 'neutral' }))} />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Observations by model" />
              <CardBody className="p-0">
                {data.observationsByModel.length === 0 ? (
                  <div className="p-5">
                    <EmptyState title="No observations in this range" />
                  </div>
                ) : (
                  <ModelTable rows={data.observationsByModel} />
                )}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Daily trend" />
            <CardBody className="p-0">
              {data.dailyTrend.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No activity in this range" />
                </div>
              ) : (
                <DailyTrendTable rows={data.dailyTrend} />
              )}
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}

function ModelTable({ rows }: { rows: { modelName: string; modelVersion: string; total: number; promoted: number }[] }) {
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    { key: 'model', header: 'Model', render: (m) => `${m.modelName} ${m.modelVersion}` },
    { key: 'total', header: 'Total', render: (m) => m.total },
    { key: 'promoted', header: 'Promoted', render: (m) => m.promoted },
  ];
  return <DataTable columns={columns} rows={rows} getRowKey={(m) => `${m.modelName}-${m.modelVersion}`} />;
}

function DailyTrendTable({ rows }: { rows: { date: string; observations: number; safetyEvents: number }[] }) {
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    { key: 'date', header: 'Date', render: (d) => d.date },
    { key: 'observations', header: 'Observations', render: (d) => d.observations },
    { key: 'events', header: 'Safety events', render: (d) => d.safetyEvents },
  ];
  return <DataTable columns={columns} rows={rows} getRowKey={(d) => d.date} />;
}
