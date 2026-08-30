import type { CursorPage, SafetyRuleDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export const SAFETY_RULE_TYPES = ['ROUTE_DEVIATION', 'GEOFENCE', 'SPEED', 'STOP'] as const;

export interface SafetyRuleListParams {
  limit?: number;
  cursor?: string;
  type?: string;
  enabled?: boolean;
  busId?: string;
  routeId?: string;
}

export async function listSafetyRules(params: SafetyRuleListParams = {}): Promise<CursorPage<SafetyRuleDto>> {
  return apiFetch(`/safety-rules${toQuery(params)}`);
}

export async function getSafetyRule(id: string): Promise<SafetyRuleDto> {
  return apiFetch(`/safety-rules/${id}`);
}

export interface SafetyRuleInput {
  type: (typeof SAFETY_RULE_TYPES)[number];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  geofenceId?: string;
  routeId?: string;
  busId?: string;
  thresholdMeters?: number;
  thresholdSpeedKmh?: number;
  minConsecutivePoints?: number;
  cooldownSeconds?: number;
}

export async function createSafetyRule(input: SafetyRuleInput): Promise<SafetyRuleDto> {
  return apiFetch('/safety-rules', { method: 'POST', body: input });
}

export async function updateSafetyRule(id: string, input: Partial<Omit<SafetyRuleInput, 'type'>>): Promise<SafetyRuleDto> {
  return apiFetch(`/safety-rules/${id}`, { method: 'PATCH', body: input });
}

export async function enableSafetyRule(id: string): Promise<SafetyRuleDto> {
  return apiFetch(`/safety-rules/${id}/enable`, { method: 'POST' });
}

export async function disableSafetyRule(id: string): Promise<SafetyRuleDto> {
  return apiFetch(`/safety-rules/${id}/disable`, { method: 'POST' });
}
