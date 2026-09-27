import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { decrypt, encrypt } from "./firestore.mjs";

const SCRIPT = fileURLToPath(new URL("./firestore.mjs", import.meta.url));

describe("cloud save backups", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("encrypts so only the passphrase opens it", () => {
    const file = encrypt('{"saves":{}}', "correct horse");
    expect(file).not.toContain("saves");
    expect(decrypt(file, "correct horse")).toBe('{"saves":{}}');
    expect(() => decrypt(file, "wrong")).toThrow(/passphrase/);
    const tampered = JSON.parse(file);
    tampered.data = Buffer.from("x".repeat(20)).toString("base64");
    expect(() => decrypt(JSON.stringify(tampered), "correct horse")).toThrow();
  });

  it("backs up every save (across pages) and restores them", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    vi.stubEnv(
      "FIREBASE_SERVICE_ACCOUNT",
      JSON.stringify({ project_id: "p", client_email: "b@p.iam", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) })
    );
    vi.stubEnv("BACKUP_PASSPHRASE", "pw");
    const written = new Map();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init = {}) => {
        const u = String(url);
        const json = (o) => new Response(JSON.stringify(o), { status: 200 });
        if (u.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "t" });
        if (init.method === "PATCH") {
          written.set(u.split("/").pop(), JSON.parse(init.body));
          return json({});
        }
        const doc = (uid) => ({
          name: `projects/p/databases/(default)/documents/saves/${uid}`,
          fields: { json: { stringValue: `{"u":"${uid}"}` }, savedAt: { integerValue: "5" } },
        });
        return u.includes("pageToken") ? json({ documents: [doc("b")] }) : json({ documents: [doc("a")], nextPageToken: "n" });
      })
    );
    const dir = mkdtempSync(join(tmpdir(), "bk-"));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      vi.resetModules();
      process.argv = ["node", SCRIPT, "backup"];
      await import("./firestore.mjs?run=backup");
      await vi.waitFor(() => expect(readdirSync(join(dir, "backups")).length).toBe(1));
      const file = join(dir, "backups", readdirSync(join(dir, "backups"))[0]);
      const plain = JSON.parse(decrypt(readFileSync(file, "utf8"), "pw"));
      expect(Object.keys(plain.saves)).toEqual(["a", "b"]);

      process.argv = ["node", SCRIPT, "restore", file, "--yes"];
      await import("./firestore.mjs?run=restore");
      await vi.waitFor(() => expect([...written.keys()]).toEqual(["a", "b"]));
      expect(written.get("a").fields.json.stringValue).toBe('{"u":"a"}');
    } finally {
      process.chdir(cwd);
    }
  });
});
