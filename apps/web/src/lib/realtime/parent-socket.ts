'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ParentChildTransportUpdatedEvent } from '@school-transport/shared-types';
import { getAccessToken } from '../token-store';

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? 'http://localhost:3001';

export type ParentSocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/**
 * Subscribes to the parent-facing realtime channel (Phase 1 Step 8) — a
 * separate namespace from staff fleet tracking (`useFleetSocket`,
 * apps/web/src/lib/realtime/gps-socket.ts). The server joins this
 * connection into rooms for the caller's own verified children only; there
 * is no room name for this hook to specify. See ParentGateway
 * (apps/api/src/parents/parent.gateway.ts).
 */
export function useParentSocket(onChildUpdate: (event: ParentChildTransportUpdatedEvent) => void) {
  const [status, setStatus] = useState<ParentSocketStatus>('connecting');
  const handlerRef = useRef(onChildUpdate);

  useEffect(() => {
    handlerRef.current = onChildUpdate;
  }, [onChildUpdate]);

  useEffect(() => {
    const socket: Socket = io(`${WS_BASE_URL}/realtime/parent`, {
      auth: (cb) => cb({ token: getAccessToken() }),
      withCredentials: true,
    });

    socket.on('connect', () => setStatus('connected'));
    socket.on('disconnect', () => setStatus((prev) => (prev === 'connected' ? 'reconnecting' : 'disconnected')));
    socket.io.on('reconnect_attempt', () => setStatus('reconnecting'));
    socket.io.on('reconnect_failed', () => setStatus('disconnected'));
    socket.on('parent.child.transport.updated', (event: ParentChildTransportUpdatedEvent) => handlerRef.current(event));

    return () => {
      socket.disconnect();
    };
  }, []);

  return { status };
}
