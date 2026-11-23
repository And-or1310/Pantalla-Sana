import type { DayData, ProgData } from "./store";

export type PendingSession = {
  token: string;
  sequence: number;
  days: Record<string, Omit<DayData, "demo">>;
  progress: ProgData;
};

/** Una clave por sesión evita que dos pestañas se sobrescriban entre sí. */
export class PendingSessions {
  constructor(private storage: Storage = localStorage) {}

  private prefix(userId: string) { return `ps.pending.${userId}.`; }
  private key(userId: string, token: string) { return this.prefix(userId) + token; }

  save(userId: string, session: PendingSession) {
    this.storage.setItem(this.key(userId, session.token), JSON.stringify(session));
  }

  list(userId: string): PendingSession[] {
    const sessions: PendingSession[] = [];
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (!key?.startsWith(this.prefix(userId))) continue;
      const stored = this.storage.getItem(key);
      if (!stored) continue;
      const session = JSON.parse(stored) as PendingSession;
      if (session.token && session.sequence > 0) sessions.push(session);
    }
    return sessions;
  }

  listUnconfirmed(userId: string, activeToken?: string, syncFailed = false) {
    return this.list(userId).filter((session) => session.token !== activeToken || syncFailed);
  }

  remove(userId: string, token: string, sequence: number) {
    const key = this.key(userId, token);
    const stored = this.storage.getItem(key);
    if (stored && (JSON.parse(stored) as PendingSession).sequence === sequence) this.storage.removeItem(key);
  }
}
