#!/usr/bin/env node
/**
 * Backups of the cloud saves (the `saves` collection in Firestore), for free.
 *
 * Firestore's own scheduled backups need a paid plan, so this does it with
 * a GitHub Action instead (.github/workflows/backup.yml): once a day it reads
 * every save with a service account, encrypts the file with your passphrase
 * (the repository is public, and saves belong to players), and keeps it as a
 * workflow artifact for 90 days.
 *
 *   node tools/backup/firestore.mjs backup            → backups/remnant-saves-<date>.enc.json
 *   node tools/backup/firestore.mjs decrypt <file>    → the saves as plain JSON (stdout)
 *   node tools/backup/firestore.mjs restore <file> --yes
 *                                                     → writes every save in the file back
 *
 * Environment: FIREBASE_SERVICE_ACCOUNT (the service account's JSON key) for
 * backup and restore, BACKUP_PASSPHRASE for backup, decrypt and restoring an
 * encrypted file. No dependencies beyond Node 18.
 */
import { createCipheriv, createDecipheriv, createSign, randomBytes, scryptSync } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ------------------------------------------------------------------ encryption

/** AES-256-GCM with a key stretched from the passphrase by scrypt. */
export function encrypt(plain, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const b64 = (b) => b.toString("base64");
  return JSON.stringify({ format: "remnant-backup", v: 1, salt: b64(salt), iv: b64(iv), tag: b64(c.getAuthTag()), data: b64(data) });
}

export function decrypt(file, passphrase) {
  const f = JSON.parse(file);
  if (f.format !== "remnant-backup") throw new Error("Not a REMNANT backup file.");
  const buf = (s) => Buffer.from(s, "base64");
  const d = createDecipheriv("aes-256-gcm", scryptSync(passphrase, buf(f.salt), 32), buf(f.iv));
  d.setAuthTag(buf(f.tag));
  try {
    return Buffer.concat([d.update(buf(f.data)), d.final()]).toString("utf8");
  } catch {
    throw new Error("Wrong passphrase, or the file is damaged.");
  }
}

// ------------------------------------------------------------------ Google auth

/** An OAuth access token for the service account (a signed JWT exchanged at Google's token endpoint). */
async function accessToken(account) {
  const now = Math.floor(Date.now() / 1000);
  const b64url = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(account.private_key, "base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google refused the service account: ${body.error_description ?? body.error ?? res.status}`);
  return body.access_token;
}

function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;
  const account = JSON.parse(raw);
  if (!account.client_email || !account.private_key || !account.project_id)
    throw new Error("FIREBASE_SERVICE_ACCOUNT isn't a service account key.");
  return account;
}

const base = (project) => `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;

// ------------------------------------------------------------------ commands

async function backup() {
  const account = serviceAccount();
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!account || !passphrase) {
    console.log("Backups aren't set up (FIREBASE_SERVICE_ACCOUNT and BACKUP_PASSPHRASE secrets). Nothing to do.");
    return;
  }
  const token = await accessToken(account);
  const saves = {};
  let pageToken = "";
  do {
    const url = `${base(account.project_id)}/saves?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json();
    if (!res.ok) throw new Error(`Reading the saves failed: ${body.error?.message ?? res.status}`);
    for (const doc of body.documents ?? []) {
      const uid = doc.name.split("/").pop();
      saves[uid] = {
        json: doc.fields?.json?.stringValue ?? null,
        savedAt: Number(doc.fields?.savedAt?.integerValue ?? 0),
        updateTime: doc.updateTime,
      };
    }
    pageToken = body.nextPageToken ?? "";
  } while (pageToken);

  const count = Object.keys(saves).length;
  const plain = JSON.stringify({ project: account.project_id, takenAt: new Date().toISOString(), count, saves });
  mkdirSync("backups", { recursive: true });
  const file = `backups/remnant-saves-${new Date().toISOString().slice(0, 10)}.enc.json`;
  writeFileSync(file, encrypt(plain, passphrase));
  console.log(`Backed up ${count} save${count === 1 ? "" : "s"} to ${file}.`);
}

function readBackup(path) {
  const text = readFileSync(path, "utf8");
  if (JSON.parse(text).format !== "remnant-backup") return text;
  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase) throw new Error("Set BACKUP_PASSPHRASE to open an encrypted backup.");
  return decrypt(text, passphrase);
}

async function restore(path, confirmed) {
  const data = JSON.parse(readBackup(path));
  const entries = Object.entries(data.saves ?? {}).filter(([, s]) => typeof s.json === "string");
  if (!confirmed) {
    console.log(`${entries.length} saves from ${data.takenAt} in project ${data.project}. Run again with --yes to write them back.`);
    return;
  }
  const account = serviceAccount();
  if (!account) throw new Error("Set FIREBASE_SERVICE_ACCOUNT to restore.");
  const token = await accessToken(account);
  let done = 0;
  for (const [uid, s] of entries) {
    const res = await fetch(`${base(account.project_id)}/saves/${encodeURIComponent(uid)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { json: { stringValue: s.json }, savedAt: { integerValue: String(Math.floor(s.savedAt)) } } }),
    });
    if (!res.ok) throw new Error(`Restoring ${uid} failed: ${(await res.json()).error?.message ?? res.status}`);
    done++;
  }
  console.log(`Restored ${done} saves.`);
}

const isMain = !!process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url).split("?")[0];
if (isMain) {
  const [cmd, file] = process.argv.slice(2);
  const run =
    cmd === "backup"
      ? backup()
      : cmd === "decrypt" && file
        ? Promise.resolve(process.stdout.write(readBackup(file)))
        : cmd === "restore" && file
          ? restore(file, process.argv.includes("--yes"))
          : Promise.reject(new Error("Usage: firestore.mjs backup | decrypt <file> | restore <file> [--yes]"));
  run.catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
