'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { BusLocationUpdatedEvent } from '@school-transport/shared-types';
import { getAccessToken } from '../token-store';

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? 'http://localhost:3001';

export type FleetSocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/**
 * Subscribes to the realtime fleet-location gateway (Phase 1 Step 7). The
 * server authenticates the connection from `auth.token` — never a
 * client-chosen room name — and joins the caller into whichever room(s)
 * their own RBAC scope allows (see GpsGateway). `auth` is a function rather
 * than a static object so socket.io re-reads the in-memory access token on
 * every (re)connect attempt, picking up a token silently refreshed by
 * api-client.ts without this hook needing to know that happened.
 *
 * A staff session with no `gps.read` permission, or a parent session, is
 * disconnected immediately by the server — this hook surfaces that the same
 * way as any other disconnect (status becomes 'disconnected'), it does not
 * distinguish "rejected" from "network dropped."
 */
export function useFleetSocket(onLocationUpdate: (event: BusLocationUpdatedEvent) => void) {
  const [status, setStatus] = useState<FleetSocketStatus>('connecting');
  const handlerRef = useRef(onLocationUpdate);

  useEffect(() => {
    handlerRef.current = onLocationUpdate;
  }, [onLocationUpdate]);

  useEffect(() => {
    const socket: Socket = io(`${WS_BASE_URL}/realtime/fleet`, {
      auth: (cb) => cb({ token: getAccessToken() }),
      withCredentials: true,
    });

    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus((prev) => (prev === 'connected' ? 'reconnecting' : 'disconnected')));
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
    socket.io.on('reconnect_failed', () => setStatus('disconnected'));
    socket.on('bus.location.updated', (event: BusLocationUpdatedEvent) => handlerRef.current(event));

    return () => {
      socket.disconnect();
    };
  }, []);

  return { status };
}
