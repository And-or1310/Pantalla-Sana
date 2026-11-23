"""Cuotas atómicas por proceso y entre procesos que comparten el archivo SQLite."""
import hashlib
import json
import math
import sqlite3
from contextlib import closing
from pathlib import Path


class RateLimit:
    def __init__(self, path, per_hour, per_day):
        self.path = str(path)
        self.per_hour = per_hour
        self.per_day = per_day
        if min(per_hour, per_day) < 1:
            raise ValueError("Las cuotas deben ser positivas")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("create table if not exists requests (at real not null, client text not null)")
            db.execute("create index if not exists requests_at on requests(at)")
            db.execute("create table if not exists summaries (id text primary key, expires real not null, result text not null)")

    def allow(self, ip, now, minimum_interval=0):
        client = hashlib.sha256(ip.encode()).hexdigest()
        with closing(sqlite3.connect(self.path, timeout=10)) as db, db:
            db.execute("begin immediate")
            db.execute("delete from requests where at <= ?", (now - 86400,))
            if self._retry_after(db, client, now, minimum_interval):
                return False
            db.execute("insert into requests values (?, ?)", (now, client))
            return True

    def _retry_after(self, db, client, now, minimum_interval):
        rows = db.execute("select at, client from requests where at > ? order by at", (now - 86400,)).fetchall()
        recent = [at for at, stored_client in rows if stored_client == client and at > now - 3600]
        waits = [0]
        if len(rows) >= self.per_day:
            waits.append(rows[len(rows) - self.per_day][0] + 86400 - now)
        if len(recent) >= self.per_hour:
            waits.append(recent[len(recent) - self.per_hour] + 3600 - now)
        if recent and minimum_interval:
            waits.append(recent[-1] + minimum_interval - now)
        return math.ceil(max(waits))

    def retry_after(self, ip, now, minimum_interval):
        client = hashlib.sha256(ip.encode()).hexdigest()
        with closing(sqlite3.connect(self.path)) as db:
            return self._retry_after(db, client, now, minimum_interval)

    def cached_report(self, identifier, now):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("delete from summaries where expires <= ?", (now,))
            row = db.execute("select result, expires from summaries where id = ?", (identifier,)).fetchone()
            return {"summary": json.loads(row[0]), "created_at": row[1] - 600} if row else None

    def save_summary(self, identifier, summary, now):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("insert or replace into summaries values (?, ?, ?)",
                       (identifier, now + 600, json.dumps(summary, ensure_ascii=False)))
