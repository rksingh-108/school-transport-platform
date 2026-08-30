import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import type { Env } from '../config/env.schema';
import { GeofencesService } from './geofences.service';
import { SafetyRulesService } from './safety-rules.service';
import { SafetyEventsService } from '../safety/safety-events.service';
import { distanceToPolylineMeters, haversineDistanceMeters } from './geo.util';

/** Transient debounce/cooldown state, one Redis key per (rule, bus). Lost on Redis restart is an accepted, documented degradation — see ADR 0020. */
const RULE_STATE_TTL_SECONDS = 60 * 60 * 24; // hygiene only, well beyond any realistic cooldown
type RuleState = { confirmedState: string | null; candidateState: string | null; candidateCount: number; lastAlertAt: string | null };

export interface GpsPointForEvaluation {
  schoolId: string;
  busId: string;
  tripId: string | null;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  accuracyM: number | null;
}

type SafetyRuleForEvaluation = {
  id: string;
  type: string;
  severity: string;
  geofenceId: string | null;
  thresholdMeters: number | null;
  thresholdSpeedKmh: number | null;
  minConsecutivePoints: number;
  cooldownSeconds: number;
};

/**
 * Deterministic, GPS-derived operational safety rule evaluation (Phase 2
 * Step 13) — see docs/adr/0020-geofencing-and-operational-safety-rules.md.
 * Called from `GpsService.ingest()` after a fix is accepted AND advances
 * the bus's current location, wrapped in the caller's own try/catch: a
 * malformed rule or a Redis hiccup must never break GPS ingestion. Every
 * public entry point here is therefore expected to let errors propagate —
 * isolation is the caller's job, not this service's.
 */
@Injectable()
export class OperationalSafetyService {
  private readonly logger = new Logger(OperationalSafetyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService<Env, true>,
    private readonly geofencesService: GeofencesService,
    private readonly safetyRulesService: SafetyRulesService,
    private readonly safetyEventsService: SafetyEventsService,
  ) {}

  async evaluate(point: GpsPointForEvaluation): Promise<void> {
    const maxAccuracy = this.config.get('SAFETY_RULES_MAX_ACCURACY_M', { infer: true });
    if (point.accuracyM !== null && point.accuracyM > maxAccuracy) {
      return; // too imprecise to trust for corridor/geofence math — still stored normally by the caller
    }

    const routeId = point.tripId ? await this.resolveRouteId(point.schoolId, point.tripId) : null;
    const rules = (await this.safetyRulesService.getActiveRulesForTrip(
      point.schoolId,
      point.busId,
      routeId,
    )) as unknown as SafetyRuleForEvaluation[];

    for (const rule of rules) {
      try {
        switch (rule.type) {
          case 'GEOFENCE':
            await this.evaluateGeofenceRule(rule, point);
            break;
          case 'ROUTE_DEVIATION':
            if (point.tripId) await this.evaluateRouteDeviationRule(rule, point.schoolId, point.busId, point.tripId, point);
            break;
          case 'SPEED':
            await this.evaluateSpeedRule(rule, point);
            break;
          case 'STOP':
            if (point.tripId) await this.evaluateStopRule(rule, point.schoolId, point.busId, point.tripId, point);
            break;
        }
      } catch (error) {
        // One malformed rule must never block the others, or GPS ingestion.
        this.logger.error(`Safety rule ${rule.id} (${rule.type}) evaluation failed for bus ${point.busId}`, error as Error);
      }
    }
  }

  private async resolveRouteId(schoolId: string, tripId: string): Promise<string | null> {
    const trip = await this.prisma.runInTenantContext(schoolId, (tx) => tx.trip.findFirst({ where: { id: tripId }, select: { routeId: true } }));
    return trip?.routeId ?? null;
  }

  // ---------------------------------------------------------------------
  // GEOFENCE — debounced zone-membership transition, fires on both
  // directions (entry and exit), never on the first-ever observation
  // (that just establishes a baseline so a freshly-enabled rule doesn't
  // immediately fire based on wherever the bus already happens to be).
  // ---------------------------------------------------------------------
  private async evaluateGeofenceRule(rule: SafetyRuleForEvaluation, point: GpsPointForEvaluation): Promise<void> {
    if (!rule.geofenceId) return;
    const geofence = await this.geofencesService.getRawById(point.schoolId, rule.geofenceId);
    if (!geofence) return; // archived/deleted mid-flight

    const distance = haversineDistanceMeters(point.latitude, point.longitude, geofence.latitude, geofence.longitude);
    const rawState = distance <= geofence.radiusMeters ? 'INSIDE' : 'OUTSIDE';

    const transition = await this.debounceAndMaybeFire(
      this.ruleStateKey(point.schoolId, point.busId, rule.id),
      rawState,
      rule.minConsecutivePoints,
      rule.cooldownSeconds,
      true,
    );
    if (!transition) return;

    const type = transition.to === 'INSIDE' ? 'GEOFENCE_ENTRY' : 'GEOFENCE_EXIT';
    await this.safetyEventsService.createSystemEvent({
      schoolId: point.schoolId,
      busId: point.busId,
      tripId: point.tripId,
      type,
      severity: rule.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      description: `Bus ${transition.to === 'INSIDE' ? 'entered' : 'exited'} geofence "${geofence.name}".`,
      metadata: { geofenceId: geofence.id, distanceMeters: Math.round(distance) },
    });
  }

  // ---------------------------------------------------------------------
  // ROUTE_DEVIATION — a simple corridor/tolerance model: minimum distance
  // from the current point to the polyline formed by the trip's own
  // planned stops, in sequence. Not a full navigation engine — see the ADR.
  // ---------------------------------------------------------------------
  private async evaluateRouteDeviationRule(
    rule: SafetyRuleForEvaluation,
    schoolId: string,
    busId: string,
    tripId: string,
    point: GpsPointForEvaluation,
  ): Promise<void> {
    if (rule.thresholdMeters === null) return;
    const stops = await this.prisma.runInTenantContext(schoolId, (tx) =>
      tx.tripStop.findMany({ where: { tripId }, orderBy: { sequenceNo: 'asc' }, select: { latitude: true, longitude: true } }),
    );
    const distance = distanceToPolylineMeters({ latitude: point.latitude, longitude: point.longitude }, stops);
    if (!Number.isFinite(distance)) return; // fewer than 2 stops — nothing to measure a corridor against

    const rawState = distance > rule.thresholdMeters ? 'VIOLATING' : 'OK';
    const transition = await this.debounceAndMaybeFire(
      this.ruleStateKey(schoolId, busId, rule.id),
      rawState,
      rule.minConsecutivePoints,
      rule.cooldownSeconds,
      false,
    );
    if (!transition || transition.to !== 'VIOLATING') return;

    await this.safetyEventsService.createSystemEvent({
      schoolId,
      busId,
      tripId,
      type: 'ROUTE_DEVIATION',
      severity: rule.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      description: `Bus is ${Math.round(distance)}m from its planned route (threshold ${rule.thresholdMeters}m).`,
      metadata: { distanceMeters: Math.round(distance), thresholdMeters: rule.thresholdMeters },
    });
  }

  // ---------------------------------------------------------------------
  // SPEED — GPS-reported speed only; never fabricated from a single noisy
  // point when the device doesn't report it.
  // ---------------------------------------------------------------------
  private async evaluateSpeedRule(rule: SafetyRuleForEvaluation, point: GpsPointForEvaluation): Promise<void> {
    if (rule.thresholdSpeedKmh === null || point.speedKmh === null) return;

    const rawState = point.speedKmh > rule.thresholdSpeedKmh ? 'VIOLATING' : 'OK';
    const transition = await this.debounceAndMaybeFire(
      this.ruleStateKey(point.schoolId, point.busId, rule.id),
      rawState,
      rule.minConsecutivePoints,
      rule.cooldownSeconds,
      false,
    );
    if (!transition || transition.to !== 'VIOLATING') return;

    await this.safetyEventsService.createSystemEvent({
      schoolId: point.schoolId,
      busId: point.busId,
      tripId: point.tripId,
      type: 'EXCESSIVE_SPEED',
      severity: rule.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      description: `Bus reported ${point.speedKmh.toFixed(0)} km/h (configured threshold ${rule.thresholdSpeedKmh} km/h). This reflects a configured operational threshold, not a legal speed limit.`,
      metadata: { speedKmh: point.speedKmh, thresholdSpeedKmh: rule.thresholdSpeedKmh },
    });
  }

  // ---------------------------------------------------------------------
  // STOP (UNEXPECTED_STOP) — stationary (speed at/below the rule's
  // stationary-speed threshold) AND not within thresholdMeters of any of
  // the trip's planned stops. Deliberately does NOT attempt MISSED_STOP
  // (comparing an actual stop against a schedule/attendance record) — see
  // the ADR for why that isn't reliably determinable from GPS alone.
  // ---------------------------------------------------------------------
  private async evaluateStopRule(
    rule: SafetyRuleForEvaluation,
    schoolId: string,
    busId: string,
    tripId: string,
    point: GpsPointForEvaluation,
  ): Promise<void> {
    if (rule.thresholdSpeedKmh === null || rule.thresholdMeters === null || point.speedKmh === null) return;

    let rawState = 'OK';
    if (point.speedKmh <= rule.thresholdSpeedKmh) {
      const stops = await this.prisma.runInTenantContext(schoolId, (tx) =>
        tx.tripStop.findMany({ where: { tripId }, select: { latitude: true, longitude: true } }),
      );
      const nearestStopDistance =
        stops.length === 0
          ? Infinity
          : Math.min(...stops.map((s) => haversineDistanceMeters(point.latitude, point.longitude, s.latitude, s.longitude)));
      if (nearestStopDistance > rule.thresholdMeters) rawState = 'VIOLATING';
    }

    const transition = await this.debounceAndMaybeFire(
      this.ruleStateKey(schoolId, busId, rule.id),
      rawState,
      rule.minConsecutivePoints,
      rule.cooldownSeconds,
      false,
    );
    if (!transition || transition.to !== 'VIOLATING') return;

    await this.safetyEventsService.createSystemEvent({
      schoolId,
      busId,
      tripId,
      type: 'UNEXPECTED_STOP',
      severity: rule.severity as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL',
      description: `Bus has been stationary away from any planned stop for ${rule.minConsecutivePoints} consecutive readings.`,
      metadata: { thresholdSpeedKmh: rule.thresholdSpeedKmh, thresholdMeters: rule.thresholdMeters },
    });
  }

  // ---------------------------------------------------------------------
  // Shared debounce/cooldown state machine
  // ---------------------------------------------------------------------

  /**
   * Confirms `rawState` only after `minConsecutivePoints` consecutive
   * agreeing observations, then fires at most once per `cooldownSeconds`
   * per confirmed transition. `suppressFirstObservation` controls whether
   * the very first confirmation (no prior confirmed state at all) counts
   * as a "transition" worth firing — `true` for GEOFENCE (a freshly-loaded
   * rule shouldn't immediately announce whatever zone the bus already
   * happens to be in), `false` for the threshold-style rules (ROUTE_
   * DEVIATION/SPEED/STOP), whose implicit baseline is "OK," so the first
   * confirmed violation is a genuine, reportable event. If Redis loses
   * this key (restart, eviction), evaluation simply starts over from a
   * clean baseline — a brief detection gap, never a false event; the
   * persisted SafetyEvent record remains the authoritative history
   * regardless (see the ADR's "Redis is transient state, not the record
   * of truth" decision).
   */
  private async debounceAndMaybeFire(
    redisKey: string,
    rawState: string,
    minConsecutivePoints: number,
    cooldownSeconds: number,
    suppressFirstObservation: boolean,
  ): Promise<{ from: string | null; to: string } | null> {
    const raw = await this.redis.client.get(redisKey);
    const state: RuleState = raw ? (JSON.parse(raw) as RuleState) : { confirmedState: null, candidateState: null, candidateCount: 0, lastAlertAt: null };

    if (state.candidateState === rawState) {
      state.candidateCount += 1;
    } else {
      state.candidateState = rawState;
      state.candidateCount = 1;
    }

    let result: { from: string | null; to: string } | null = null;

    if (state.candidateCount >= minConsecutivePoints && state.confirmedState !== rawState) {
      const isFirstObservation = state.confirmedState === null;
      if (!(isFirstObservation && suppressFirstObservation)) {
        const cooledDown =
          !state.lastAlertAt || (Date.now() - new Date(state.lastAlertAt).getTime()) / 1000 >= cooldownSeconds;
        if (cooledDown) {
          result = { from: state.confirmedState, to: rawState };
          state.lastAlertAt = new Date().toISOString();
        }
      }
      state.confirmedState = rawState;
    }

    await this.redis.client.set(redisKey, JSON.stringify(state), 'EX', RULE_STATE_TTL_SECONDS);
    return result;
  }

  private ruleStateKey(schoolId: string, busId: string, ruleId: string): string {
    return `school:${schoolId}:bus:${busId}:rule:${ruleId}:state`;
  }
}
