'use client';

import { useState } from 'react';
import { getSafetyAnalytics } from '@/lib/api/safety-analytics';
import { useAsync } from '@/lib/use-async';
import { ApiError } from '@/lib/api-client';
import { Input } from '@/components/ui/field';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/states';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function SummaryCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-xs uppercase text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{value}</p>
    </div>
  );
}

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-40 shrink-0 truncate text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className="h-full rounded-full bg-zinc-900 dark:bg-zinc-100" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 shrink-0 text-right text-zinc-500">{count}</span>
    </div>
  );
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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Safety Analytics</h1>
          <p className="text-sm text-zinc-500">
            Aggregated operational trends across AI observations, safety events, and emergencies — never raw detection rows.
          </p>
        </div>
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
      </div>

      {loading && <LoadingState label="Loading analytics…" />}
      {!loading && !!error && (
        <ErrorState message={error instanceof ApiError ? error.message : 'Failed to load analytics — the date range may exceed 90 days.'} onRetry={reload} />
      )}
      {!loading && !error && data && (
        <div className="space-y-8">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <SummaryCard label="AI observations" value={data.summary.totalObservations} />
            <SummaryCard label="Promoted" value={data.summary.promoted} />
            <SummaryCard label="Dismissed" value={data.summary.dismissed} />
            <SummaryCard label="Pending review" value={data.summary.pendingReview} />
            <SummaryCard label="Safety events" value={data.summary.totalSafetyEvents} />
            <SummaryCard label="Emergencies" value={data.summary.totalEmergencies} />
            <SummaryCard label="Promotion rate" value={data.summary.promotionRate !== null ? `${(data.summary.promotionRate * 100).toFixed(0)}%` : '—'} />
            <SummaryCard
              label="Avg. review time"
              value={data.summary.averageReviewTimeSeconds !== null ? `${Math.round(data.summary.averageReviewTimeSeconds / 60)}m` : '—'}
            />
          </div>
          <p className="text-xs text-zinc-500">
            &ldquo;Promotion rate&rdquo; reflects how often staff chose to promote a reviewed detection — it is not a measure of model accuracy, since human review is not a scientific ground-truth evaluation.
          </p>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Observations by detection type</h2>
            {data.observationsByDetectionType.length === 0 ? (
              <EmptyState title="No observations in this range" />
            ) : (
              <div className="space-y-2">
                {data.observationsByDetectionType.map((r) => (
                  <BarRow key={r.detectionType} label={r.detectionType.replace(/_/g, ' ')} count={r.count} max={Math.max(...data.observationsByDetectionType.map((x) => x.count))} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Safety events by severity</h2>
            {data.safetyEventsBySeverity.length === 0 ? (
              <EmptyState title="No safety events in this range" />
            ) : (
              <div className="space-y-2">
                {data.safetyEventsBySeverity.map((r) => (
                  <BarRow key={r.severity} label={r.severity} count={r.count} max={Math.max(...data.safetyEventsBySeverity.map((x) => x.count))} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Emergencies by status</h2>
            {data.emergenciesByStatus.length === 0 ? (
              <EmptyState title="No emergencies in this range" />
            ) : (
              <div className="space-y-2">
                {data.emergenciesByStatus.map((r) => (
                  <BarRow key={r.status} label={r.status} count={r.count} max={Math.max(...data.emergenciesByStatus.map((x) => x.count))} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Observations by model</h2>
            {data.observationsByModel.length === 0 ? (
              <EmptyState title="No observations in this range" />
            ) : (
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                    <tr>
                      <th className="px-4 py-2">Model</th>
                      <th className="px-4 py-2">Total</th>
                      <th className="px-4 py-2">Promoted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.observationsByModel.map((m) => (
                      <tr key={`${m.modelName}-${m.modelVersion}`} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">{m.modelName} {m.modelVersion}</td>
                        <td className="px-4 py-2 text-zinc-500">{m.total}</td>
                        <td className="px-4 py-2 text-zinc-500">{m.promoted}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Daily trend</h2>
            {data.dailyTrend.length === 0 ? (
              <EmptyState title="No activity in this range" />
            ) : (
              <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
                <table className="w-full text-sm">
                  <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500 dark:bg-zinc-900">
                    <tr>
                      <th className="px-4 py-2">Date</th>
                      <th className="px-4 py-2">Observations</th>
                      <th className="px-4 py-2">Safety events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dailyTrend.map((d) => (
                      <tr key={d.date} className="border-t border-zinc-100 dark:border-zinc-800">
                        <td className="px-4 py-2 text-zinc-900 dark:text-zinc-100">{d.date}</td>
                        <td className="px-4 py-2 text-zinc-500">{d.observations}</td>
                        <td className="px-4 py-2 text-zinc-500">{d.safetyEvents}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
