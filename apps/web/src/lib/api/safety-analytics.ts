import type { SafetyAnalyticsDto } from '@school-transport/shared-types';
import { apiFetch } from '../api-client';

export interface SafetyAnalyticsParams {
  from: string;
  to: string;
  busId?: string;
  detectionType?: string;
  severity?: string;
}

function toQuery(params: object): string {
  const entries = Object.entries(params as Record<string, string | number | undefined>).filter(
    ([, v]) => v !== undefined && v !== '',
  );
  return '?' + new URLSearchParams(entries as [string, string][]).toString();
}

export async function getSafetyAnalytics(params: SafetyAnalyticsParams): Promise<SafetyAnalyticsDto> {
  return apiFetch(`/analytics/safety${toQuery(params)}`);
}
