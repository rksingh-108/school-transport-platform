'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ParentChildTransportUpdatedEvent, NotificationDto } from '@school-transport/shared-types';
import { getAccessToken } from '../token-store';

const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_BASE_URL ?? 'http://localhost:3001';

export type ParentSocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

/**
 * Subscribes to the parent-facing realtime channel — a separate namespace
 * from staff fleet tracking (`useFleetSocket`,
 * apps/web/src/lib/realtime/gps-socket.ts). The server joins this
 * connection into rooms for the caller's own verified children only; there
 * is no room name for this hook to specify. See ParentGateway
 * (apps/api/src/parents/parent.gateway.ts).
 *
 * `onNotification` (Phase 1 Step 9, optional) fires for
 * `parent.notification.created` — currently only `CHILD_BOARDED`/
 * `CHILD_DROPPED_OFF` push this way; trip-level notifications are in-app +
 * REST poll only this phase (see docs/adr/0016-notifications-and-alerts.md).
 */
export function useParentSocket(onChildUpdate: (event: ParentChildTransportUpdatedEvent) => void, onNotification?: (notification: NotificationDto) => void) {
  const [status, setStatus] = useState<ParentSocketStatus>('connecting');
  const handlerRef = useRef(onChildUpdate);
  const notificationHandlerRef = useRef(onNotification);

  useEffect(() => {
    handlerRef.current = onChildUpdate;
  }, [onChildUpdate]);
  useEffect(() => {
    notificationHandlerRef.current = onNotification;
  }, [onNotification]);

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
    socket.on('parent.notification.created', (notification: NotificationDto) => notificationHandlerRef.current?.(notification));

    return () => {
      socket.disconnect();
    };
  }, []);

  return { status };
}
