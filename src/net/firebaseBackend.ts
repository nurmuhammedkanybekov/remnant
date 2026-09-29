import type { CloudBackend, CloudUser } from "./cloud";
import type { BoardEntry } from "./leaderboard";

interface FirestoreValue {
  stringValue?: string;
  doubleValue?: number;
  integerValue?: string;
  mapValue?: { fields?: Record<string, FirestoreValue> };
}
interface FirestoreDoc {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

/** A leaderboard document from the REST API, as an entry. */
export function boardEntry(d: FirestoreDoc): BoardEntry {
  const f = d.fields ?? {};
  const times: Record<string, number> = {};
  for (const [k, v] of Object.entries(f.times?.mapValue?.fields ?? {})) {
    const n = v.doubleValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : NaN);
    if (Number.isFinite(n)) times[k] = n;
  }
  return { uid: d.name.split("/").pop() ?? "", name: (f.name?.stringValue ?? "Survivor").slice(0, 16), times };
}

/**
 * Firebase settings, from the build (GitHub repository variables). All three
 * are public by design — Firebase web config is meant to ship in the page;
 * what protects the data is the database rules (see the README).
 */
export interface FirebaseConfig {
  apiKey: string;
  projectId: string;
  authDomain: string;
}

export function firebaseConfig(env: Record<string, string | undefined> = import.meta.env): FirebaseConfig | null {
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim() ?? "";
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim() ?? "";
  if (!apiKey || !projectId) return null;
  return { apiKey, projectId, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN?.trim() || `${projectId}.firebaseapp.com` };
}

/**
 * Sign-in through the Firebase SDK (loaded only when cloud saves are used);
 * the save itself goes to Firestore over its REST API with the player's
 * token, which keeps the database SDK — the largest part of Firebase — out
 * of the game entirely.
 */
export async function firebaseBackend(cfg: FirebaseConfig): Promise<CloudBackend> {
  const { initializeApp } = await import("firebase/app");
  const auth = await import("firebase/auth");
  const app = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId });
  const a = auth.getAuth(app);
  const base = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/databases/(default)/documents`;
  const docUrl = (uid: string) => `${base}/saves/${encodeURIComponent(uid)}`;
  const headers = async (): Promise<Record<string, string>> => {
    const token = await a.currentUser?.getIdToken();
    if (!token) throw new Error("Not signed in.");
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  };
  const check = async (res: Response, what: "save" | "leaderboard" = "save") => {
    if (res.ok) return;
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const why = body?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(
      res.status === 403
        ? what === "leaderboard"
          ? "The leaderboard isn't open yet: the database rules need the leaderboard section (see the README)."
          : "The cloud refused this save (check the database rules in the README)."
        : res.status === 404
          ? "The cloud database doesn't exist yet (create it in the Firebase console)."
          : `Cloud error: ${why}`
    );
  };

  return {
    onUser(cb) {
      auth.onAuthStateChanged(a, (u) => cb(u ? ({ uid: u.uid, name: u.displayName || u.email || "Signed in" } satisfies CloudUser) : null));
    },
    async signIn() {
      const provider = new auth.GoogleAuthProvider();
      try {
        await auth.signInWithPopup(a, provider);
      } catch (e) {
        // Some browsers block pop-ups outright: go through a full-page redirect instead.
        if ((e as { code?: string })?.code === "auth/popup-blocked") await auth.signInWithRedirect(a, provider);
        else throw e;
      }
    },
    async signOut() {
      await auth.signOut(a);
    },
    async load(uid) {
      const res = await fetch(docUrl(uid), { headers: await headers() });
      if (res.status === 404) {
        // No save yet — unless the database itself is missing.
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (body?.error?.message?.includes("does not exist")) await check(res);
        return null;
      }
      await check(res);
      const doc = (await res.json()) as { fields?: { json?: { stringValue?: string } } };
      return doc.fields?.json?.stringValue ?? null;
    },
    board: {
      async list() {
        const out: BoardEntry[] = [];
        let page = "";
        // A few pages at most: one document per player.
        for (let i = 0; i < 5; i++) {
          const res = await fetch(`${base}/leaderboard?pageSize=300${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`, {
            headers: await headers(),
          });
          await check(res, "leaderboard");
          const body = (await res.json()) as { documents?: FirestoreDoc[]; nextPageToken?: string };
          for (const d of body.documents ?? []) out.push(boardEntry(d));
          if (!body.nextPageToken) break;
          page = body.nextPageToken;
        }
        return out;
      },
      async put(uid, name, times) {
        const keys = Object.keys(times);
        const mask = ["name", "updatedAt", ...keys.map((k) => `times.${k}`)]
          .map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`)
          .join("&");
        const res = await fetch(`${base}/leaderboard/${encodeURIComponent(uid)}?${mask}`, {
          method: "PATCH",
          headers: await headers(),
          body: JSON.stringify({
            fields: {
              name: { stringValue: name },
              updatedAt: { integerValue: String(Date.now()) },
              times: { mapValue: { fields: Object.fromEntries(keys.map((k) => [k, { doubleValue: times[k] }])) } },
            },
          }),
        });
        await check(res, "leaderboard");
      },
    },
    async store(uid, json, savedAt) {
      const res = await fetch(docUrl(uid), {
        method: "PATCH",
        headers: await headers(),
        body: JSON.stringify({ fields: { json: { stringValue: json }, savedAt: { integerValue: String(Math.floor(savedAt)) } } }),
      });
      await check(res);
    },
  };
}
