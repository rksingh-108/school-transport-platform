import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SafetyAnalyticsDto } from '@school-transport/shared-types';
import type { SafetyAnalyticsQuery } from '@school-transport/shared-schemas';
import { PrismaService } from '../database/prisma.service';
import type { AuthenticatedPrincipal } from '../auth/types/principal';

type DailyTrendRow = { day: Date; count: bigint };

/**
 * Operational safety analytics (Phase 3 Step 15) — aggregated-only reads
 * across the existing AIObservation/SafetyEvent/Emergency tables. No new
 * event/history table is created; this module is read-only and never
 * touches ingestion, review, or any other write path — see
 * docs/adr/0022-ai-observation-review-and-safety-analytics.md's
 * "analytics failure" decision (a bug here can never affect GPS,
 * attendance, or safety-event creation). Every query is database-side
 * aggregation (COUNT/GROUP BY) — never "load every row and reduce in
 * Node," and every raw query is a parameterized `Prisma.sql` template
 * scoped to the same bounded date range Zod already validated (see
 * safetyAnalyticsQuerySchema's max-90-days refinement).
 */
@Injectable()
export class SafetyAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(principal: AuthenticatedPrincipal, query: SafetyAnalyticsQuery): Promise<SafetyAnalyticsDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);

    return this.prisma.runInTenantContext(principal.schoolId, async (tx) => {
      const school = await tx.school.findUniqueOrThrow({ where: { id: principal.schoolId }, select: { timezone: true } });

      const observationWhere: Prisma.AIObservationWhereInput = {
        occurredAt: { gte: from, lte: to },
        busId: query.busId,
        detectionType: query.detectionType,
      };
      const safetyEventWhere: Prisma.SafetyEventWhereInput = {
        occurredAt: { gte: from, lte: to },
        busId: query.busId,
        severity: query.severity,
      };
      const emergencyWhere: Prisma.EmergencyWhereInput = {
        startedAt: { gte: from, lte: to },
        busId: query.busId,
        severity: query.severity,
      };

      const [
        totalObservations,
        promoted,
        dismissed,
        pendingReview,
        totalSafetyEvents,
        totalEmergencies,
        reviewedTimings,
        observationsByDetectionTypeRaw,
        observationsByModelRaw,
        promotedByModelRaw,
        safetyEventsBySeverityRaw,
        safetyEventsByBusRaw,
        emergenciesByStatusRaw,
        dailyObservations,
        dailySafetyEvents,
      ] = await Promise.all([
        tx.aIObservation.count({ where: observationWhere }),
        tx.aIObservation.count({ where: { ...observationWhere, status: 'PROMOTED' } }),
        tx.aIObservation.count({ where: { ...observationWhere, status: 'DISMISSED' } }),
        tx.aIObservation.count({ where: { ...observationWhere, status: { in: ['CANDIDATE', 'REVIEWED'] } } }),
        tx.safetyEvent.count({ where: safetyEventWhere }),
        tx.emergency.count({ where: emergencyWhere }),
        // Only the two narrow timestamp columns for reviewed rows — bounded
        // by the same validated date range, never "every observation."
        tx.aIObservation.findMany({
          where: { ...observationWhere, reviewedAt: { not: null } },
          select: { occurredAt: true, reviewedAt: true },
        }),
        tx.aIObservation.groupBy({ by: ['detectionType'], where: observationWhere, _count: { _all: true } }),
        tx.aIObservation.groupBy({ by: ['modelId'], where: observationWhere, _count: { _all: true } }),
        tx.aIObservation.groupBy({ by: ['modelId'], where: { ...observationWhere, status: 'PROMOTED' }, _count: { _all: true } }),
        tx.safetyEvent.groupBy({ by: ['severity'], where: safetyEventWhere, _count: { _all: true } }),
        tx.safetyEvent.groupBy({ by: ['busId'], where: { ...safetyEventWhere, busId: { not: null } }, _count: { _all: true } }),
        tx.emergency.groupBy({ by: ['status'], where: emergencyWhere, _count: { _all: true } }),
        tx.$queryRaw<DailyTrendRow[]>(
          Prisma.sql`SELECT (occurred_at AT TIME ZONE ${school.timezone})::date AS day, count(*)::int AS count
                     FROM ai_observations
                     WHERE school_id = ${principal.schoolId}
                       AND occurred_at >= ${from} AND occurred_at <= ${to}
                       ${query.busId ? Prisma.sql`AND bus_id = ${query.busId}` : Prisma.empty}
                       ${query.detectionType ? Prisma.sql`AND detection_type = ${query.detectionType}::"AIDetectionType"` : Prisma.empty}
                     GROUP BY day ORDER BY day`,
        ),
        tx.$queryRaw<DailyTrendRow[]>(
          Prisma.sql`SELECT (occurred_at AT TIME ZONE ${school.timezone})::date AS day, count(*)::int AS count
                     FROM safety_events
                     WHERE school_id = ${principal.schoolId}
                       AND occurred_at >= ${from} AND occurred_at <= ${to}
                       ${query.busId ? Prisma.sql`AND bus_id = ${query.busId}` : Prisma.empty}
                       ${query.severity ? Prisma.sql`AND severity = ${query.severity}::"Severity"` : Prisma.empty}
                     GROUP BY day ORDER BY day`,
        ),
      ]);

      // Model id -> name/version, resolved in one small lookup (never a
      // per-row join across every observation) — the platform-wide
      // registry has no RLS, so this plain call is fine regardless of tx context.
      const modelIds = [...new Set(observationsByModelRaw.map((r) => r.modelId))];
      const models = modelIds.length ? await this.prisma.aIModel.findMany({ where: { id: { in: modelIds } }, select: { id: true, name: true, version: true } }) : [];
      const modelById = new Map(models.map((m) => [m.id, m]));
      const promotedByModelId = new Map(promotedByModelRaw.map((r) => [r.modelId, r._count._all]));

      const averageReviewTimeSeconds =
        reviewedTimings.length === 0
          ? null
          : reviewedTimings.reduce((sum, r) => sum + (r.reviewedAt!.getTime() - r.occurredAt.getTime()) / 1000, 0) / reviewedTimings.length;

      const dailyMap = new Map<string, { observations: number; safetyEvents: number }>();
      for (const row of dailyObservations) {
        const key = row.day.toISOString().slice(0, 10);
        dailyMap.set(key, { observations: Number(row.count), safetyEvents: dailyMap.get(key)?.safetyEvents ?? 0 });
      }
      for (const row of dailySafetyEvents) {
        const key = row.day.toISOString().slice(0, 10);
        dailyMap.set(key, { observations: dailyMap.get(key)?.observations ?? 0, safetyEvents: Number(row.count) });
      }

      return {
        summary: {
          totalObservations,
          promoted,
          dismissed,
          pendingReview,
          totalSafetyEvents,
          totalEmergencies,
          promotionRate: totalObservations > 0 ? promoted / totalObservations : null,
          dismissalRate: totalObservations > 0 ? dismissed / totalObservations : null,
          averageReviewTimeSeconds,
        },
        observationsByDetectionType: observationsByDetectionTypeRaw.map((r) => ({ detectionType: r.detectionType, count: r._count._all })),
        observationsByModel: observationsByModelRaw.map((r) => ({
          modelName: modelById.get(r.modelId)?.name ?? 'unknown',
          modelVersion: modelById.get(r.modelId)?.version ?? 'unknown',
          total: r._count._all,
          promoted: promotedByModelId.get(r.modelId) ?? 0,
        })),
        safetyEventsBySeverity: safetyEventsBySeverityRaw.map((r) => ({ severity: r.severity, count: r._count._all })),
        safetyEventsByBus: safetyEventsByBusRaw.map((r) => ({ busId: r.busId!, count: r._count._all })),
        emergenciesByStatus: emergenciesByStatusRaw.map((r) => ({ status: r.status, count: r._count._all })),
        dailyTrend: [...dailyMap.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, v]) => ({ date, ...v })),
      };
    });
  }
}
