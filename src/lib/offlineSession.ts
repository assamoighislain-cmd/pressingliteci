import type { Session, User } from '@supabase/supabase-js';

const OFFLINE_SESSION_BACKUP_KEY = 'pressinglite_offline_session_v1';

export interface OfflineSessionBackup {
  user: User;
  session: Session;
  savedAt: number;
}

export function readOfflineSessionBackup(): OfflineSessionBackup | null {
  try {
    const raw = localStorage.getItem(OFFLINE_SESSION_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineSessionBackup;
    if (!parsed || !parsed.user || !parsed.user.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeOfflineSessionBackup(session: Session | null): void {
  if (!session || !session.user) return;
  try {
    const payload: OfflineSessionBackup = {
      user: session.user,
      session,
      savedAt: Date.now(),
    };
    localStorage.setItem(OFFLINE_SESSION_BACKUP_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota errors
  }
}

export function clearOfflineSessionBackup(): void {
  try {
    localStorage.removeItem(OFFLINE_SESSION_BACKUP_KEY);
  } catch {
    // Ignore
  }
}
