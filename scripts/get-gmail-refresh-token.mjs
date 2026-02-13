#!/usr/bin/env node
/**
 * One-time flow to get a Gmail OAuth refresh token.
 * Uses a local server to catch the redirect after you sign in.
 *
 * Prerequisites:
 * - GCP project with OAuth consent screen and a Web application client
 *   (APIs & Services → Credentials → Create OAuth client ID → Web application).
 * - Add Authorized redirect URI: http://127.0.0.1:9999/callback
 * - Gmail API enabled.
 *
 * Run: node scripts/get-gmail-refresh-token.mjs
 * Or:  GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/get-gmail-refresh-token.mjs
 *
 * Then add the printed refresh token to .env and Trigger.dev env vars.
 */

import { createServer } from "node:http";
import { exec } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const REDIRECT_PORT = 9999;
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function loadEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return {};
  const raw = readFileSync(envPath, "utf-8");
  const out = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
  }
  return out;
}

function openUrl(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`, (err) => {
    if (err) console.warn("Could not open browser:", err.message);
  });
}

async function exchangeCode(clientId, clientSecret, code) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${t}`);
  }
  return res.json();
}

function main() {
  const env = loadEnv();
  let clientId = process.env.GMAIL_CLIENT_ID ?? env.GMAIL_CLIENT_ID;
  let clientSecret = process.env.GMAIL_CLIENT_SECRET ?? env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Need GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.");
    console.error("Set them in .env or run:");
    console.error('  GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node scripts/get-gmail-refresh-token.mjs');
    process.exit(1);
  }

  const authUrl =
    `${AUTH_URL}?` +
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPE,
      access_type: "offline",
      prompt: "consent",
    }).toString();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${REDIRECT_PORT}`);
    if (url.pathname !== "/callback") {
      res.writeHead(404).end("Not found");
      return;
    }
    const code = url.searchParams.get("code");
    if (!code) {
      res.writeHead(400).end("Missing code in URL");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<p>Authorization received. You can close this tab and return to the terminal.</p>"
    );

    try {
      const tokens = await exchangeCode(clientId, clientSecret, code);
      server.close();
      if (tokens.refresh_token) {
        console.log("\nRefresh token (add to .env and Trigger.dev):\n");
        console.log(tokens.refresh_token);
        console.log("");
      } else {
        console.log("No refresh_token in response (you may have already authorized). Tokens:", tokens);
      }
      process.exit(0);
    } catch (e) {
      server.close();
      console.error(e);
      process.exit(1);
    }
  });

  server.listen(REDIRECT_PORT, "127.0.0.1", () => {
    console.log("Open this URL in your browser and sign in with the Gmail account to label:\n");
    console.log(authUrl);
    console.log("\nWaiting for callback on http://127.0.0.1:9999/callback ...");
    openUrl(authUrl);
  });
}

main();
