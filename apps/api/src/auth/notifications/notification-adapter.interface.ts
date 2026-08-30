/**
 * Boundary for delivering auth-related messages (password reset links,
 * invitation links) to a principal. No real email/SMS vendor is wired up yet
 * — see docs/roadmap.md Phase 1 notifications work — but every call site
 * depends on this interface, not a concrete provider, so adding a real
 * provider later touches one file, not every caller.
 */
export interface AuthNotificationAdapter {
  sendPasswordResetLink(params: {
    to: { email?: string | null; phone?: string | null };
    principalType: 'STAFF' | 'PARENT';
    resetToken: string;
  }): Promise<void>;

  sendInvitationLink(params: {
    to: { email?: string | null; phone?: string | null };
    principalType: 'STAFF' | 'PARENT';
    fullName: string;
    invitationToken: string;
  }): Promise<void>;
}

export const AUTH_NOTIFICATION_ADAPTER = Symbol('AUTH_NOTIFICATION_ADAPTER');
