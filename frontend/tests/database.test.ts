import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
try {
  // Supabase proporciona auth y storage. El test recrea solo su contrato PostgreSQL.
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('test.uid',true),'')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql as $$
      select current_setting('test.jwt',true)::jsonb
    $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text references storage.buckets,name text);
    alter table storage.objects enable row level security;
    grant usage on schema auth,storage to authenticated;
    grant select,insert on storage.objects to authenticated;
  `);
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(fileURLToPath(migrations))).sort()) {
    if (file.endsWith(".sql")) await db.exec(await readFile(new URL(file, migrations), "utf8"));
  }
  const user = "09430c83-02f1-40ec-8717-f57608c3cb49";
  const other = "c9188677-c429-48c2-b089-bbc86e27f004";
  const pc = "2ae2f091-81e0-4b9e-85b7-fb861d8bcbb8";
  const laptop = "e2308dc8-34de-471e-846b-4b1019b55f99";
  const source = "b9923cbb-9637-4fd5-b900-d8443b5dcb84";
  await db.query("insert into auth.users values ($1),($2)", [user, other]);
  const day = (await db.query<{ day: string }>("select current_date::text as day")).rows[0].day;
  const signIn = (id: string, provider = "google") => db.query(
    "select set_config('test.uid',$1,false),set_config('test.jwt',$2,false)",
    [id, JSON.stringify({ app_metadata: { provider } })],
  );
  const call = async (name: string, args: unknown[] = []) => {
    const parameters = args.map((_, i) => `$${i + 1}`).join(",");
    return (await db.query<{ result: any }>(`select ${name}(${parameters}) result`, args)).rows[0].result;
  };
  const progress = (xp: number) => ({
    xp, streak: 0, best: 0, last_day: "", day, good_today: 60, rescues: 1,
    album: { pikachu: { pack: "Pokémon", title: "Pikachu", art: "https://example.com/card.png", rarity: "rara", got: day } },
    packs: 1, companion: "pikachu", log: { [day]: 60 }, carry: 5,
  });
  const metrics = (seconds: number) => ({
    [day]: { session_sec: seconds, total_sec: seconds, good_sec: seconds, alerts: {}, bpm_w: 0, bpm_sec: 0, hours: {} },
  });
  const profile = (id = user) => call("ps_profile", [id]);
  const monitor = (action: string, token: string, seconds = 0, xp?: number) => call("ps_account_monitor",
    [user, action, token, metrics(seconds), xp === undefined ? null : progress(xp)]);
  const recover = (token: string, seconds: number, xp: number, seq = 1) => call("ps_recover_session",
    [user, token, seq, metrics(seconds), progress(xp)]);
  const expire = async () => {
    await db.exec("reset role");
    await db.query("update pantalla_private.monitor set expires_at = now() - interval '1 second' where user_id=$1", [user]);
    await db.exec("set role authenticated");
  };

  await db.exec("set role anon");
  await assert.rejects(() => profile(), /permission denied/);
  await db.exec("set role authenticated");
  await signIn(user, "email");
  await assert.rejects(() => profile(), /Google sign-in required/);
  await signIn(user);
  await assert.rejects(() => profile(other), /Account changed/);
  await assert.rejects(() => db.query("select * from pantalla_private.profile"), /permission denied/);
  await call("ps_preferences", [user, { groups: { posture: false } }, false]);
  const preferences = await call("ps_preferences", [user, { groups: { blink: false } }, false]);
  assert.deepEqual(preferences.preferences.groups, { posture: false, blink: false });

  await call("ps_merge_guest_progress", [user, source, progress(10), {}]);
  await call("ps_merge_guest_progress", [user, source, progress(10), {}]);
  assert.equal((await profile()).progress.xp, 10);
  assert.equal((await monitor("claim", pc)).status, "active");
  assert.equal((await monitor("claim", laptop)).status, "busy");
  assert.equal((await monitor("sync", pc, 10, 20)).status, "active");
  assert.equal((await monitor("move", laptop)).status, "waiting");
  assert.equal((await monitor("sync", pc, 12, 22)).status, "moving");
  await monitor("release", pc, 14, 24);
  assert.equal((await monitor("claim", laptop)).profile.progress.xp, 24);
  assert.equal((await monitor("sync", pc, 16, 99)).status, "ended");
  assert.equal((await profile()).progress.xp, 24);
  await monitor("sync", laptop, 20, 30);
  await expire();
  assert.equal((await recover(laptop, 24, 35)).status, "recovered");
  assert.equal((await recover(laptop, 24, 35)).status, "recovered");
  assert.equal((await profile()).progress.xp, 35);
  assert.equal((await recover(laptop, 25, 36, 2)).status, "recovered");
  assert.equal((await recover(laptop, 24, 35)).status, "recovered");
  assert.equal((await profile()).progress.xp, 36);
  const history = await call("ps_history", [day, day]);
  assert.equal(history.reduce((sum: number, row: any) => sum + row.metrics.session_sec, 0), 39);

  // Un snapshot anterior no sustituye el progreso confirmado en otra sesión.
  assert.equal((await monitor("claim", pc)).status, "active");
  await monitor("sync", pc, 18, 40);
  await expire();
  await monitor("claim", laptop);
  await monitor("sync", laptop, 28, 50);
  await monitor("release", laptop, 28, 50);
  assert.equal((await recover(pc, 19, 45)).status, "conflict");
  assert.equal((await profile()).progress.xp, 50);
  await assert.rejects(() => recover(source, 1, 1), /Unknown recovery session/);
  await db.query("insert into storage.objects values ('pantalla-profile-media',$1)", [user + "/image/" + source]);
  await assert.rejects(() => db.query("insert into storage.objects values ('pantalla-profile-media',$1)",
    [other + "/image/" + source]), /row-level security/);
  await signIn(other);
  assert.equal((await profile(other)).progress, null);
  assert.equal((await db.query("select * from storage.objects")).rows.length, 0);
  console.log("PostgreSQL OK. Migraciones, permisos, importación, traspaso, recuperación e idempotencia.");
} finally {
  await db.close();
}
