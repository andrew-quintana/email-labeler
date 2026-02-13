# Gmail OAuth setup (GCP)

To use the **poll-and-label** and **label-one-message** tasks, you need Gmail OAuth credentials (Client ID, Client Secret, Refresh token). This doc covers the GCP and OAuth steps. For the full project setup order, see the [README Setup section](../README.md#setup).

**Quick sequence (after GCP project + OAuth client exist):** From the repo root run `pnpm run setup:gmail` (paste Client ID and Secret), then `pnpm run get-refresh-token` (browser sign-in → copy refresh token), then `pnpm run setup:gmail-refresh-token` (paste token into `.env`). Optional: `pnpm run setup:gcp-gmail` prints GCP links if you have `gcloud` installed.

## 1. Create or select a GCP project

- Go to [Google Cloud Console](https://console.cloud.google.com/).
- Create a new project or select an existing one (e.g. “Email Labeler”).

## 2. Enable the Gmail API

- In the console: **APIs & Services → Library**.
- Search for **Gmail API** and click it. Click **Enable** for your project.
- If you see *“Gmail API has not been used in project … before or it is disabled”* when running tasks, open the Gmail API page for your project and enable it: **APIs & Services → Library → Gmail API → Enable**. Wait a few minutes after enabling, then retry.

## 3. OAuth consent screen (app and branding)

- **APIs & Services → OAuth consent screen**.
- Choose **External** (or Internal if the project is in a Google Workspace org).
- **App information**
  - **App name:** e.g. “Email Labeler” (users see this when authorizing).
  - **User support email:** your email.
  - **App logo:** optional; upload if you want branding on the consent screen.
- **App domain** (optional): leave blank for a personal/CLI-style app.
- **Developer contact:** your email.
- **Scopes:** add **`.../auth/gmail.modify`** (or **Gmail API → Edit labels and read/write mail**) so the app can read and label mail. Add **`.../auth/gmail.readonly`** if you only need read; for this repo you need modify.
- **Test users** (only if you leave the app in Testing): add the Gmail address you will use to sign in. If you don’t add test users and don’t publish, you’ll get **Error 403: access_denied** (“can only be accessed by developer-approved testers”).

- To sign in while the app is in **Testing**: when Google shows “This app isn’t verified” or “only be accessed by developer-approved testers”, you can click **Continue** (or **Advanced** → **Go to [app name]**) to proceed. Add your Gmail as a **Test user** on the OAuth consent screen first (Test users → + ADD USERS), then use **Continue** when signing in.
- **Optional:** Click **PUBLISH APP** on the OAuth consent screen to move the app to “In production” so you don’t need the Test users list; for personal use, clicking **Continue** on the warning is enough.

## 4. Create OAuth 2.0 credentials and register the redirect URI

- **APIs & Services → Credentials → Create credentials → OAuth client ID**.
- **Application type:** **Web application**.
- **Name:** e.g. “Email Labeler”.
- **Authorized redirect URIs:** click **+ ADD URI** and add this **exact** URI (copy‑paste; no trailing slash):
  ```
  http://127.0.0.1:9999/callback
  ```
  If you skip this, you’ll get: *“This app doesn’t comply with Google’s OAuth 2.0 policy … register the redirect URI”*.
- Click **Create**. Copy the **Client ID** and **Client Secret** for `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`.

**If you already created the client:** go to **APIs & Services → Credentials**, click your **Web client** name, under **Authorized redirect URIs** click **+ ADD URI**, paste `http://127.0.0.1:9999/callback`, then **Save**.

## 5. Get a refresh token

The app needs a **refresh token** so it can get new access tokens without signing in again.

**Option A – Script in this repo (recommended)**

1. Put your Client ID and Client Secret in `.env`. Easiest: run `pnpm run setup:gmail` and paste them when prompted.
2. From the repo root, run:
   ```bash
   pnpm run get-refresh-token
   ```
3. A browser window opens; sign in with the **Gmail account whose mailbox you want to label** and allow access.
4. The script prints the **refresh token**. Copy it into `.env` as `GMAIL_REFRESH_TOKEN` (or run `pnpm run setup:gmail-refresh-token` and paste). Also add `GMAIL_REFRESH_TOKEN` in Trigger.dev (Project → Environment Variables) for deployed runs.

**Option B – OAuth 2.0 Playground**

1. Go to [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).
2. Click the gear (⚙️), check **Use your own OAuth credentials**, and enter your Client ID and Client Secret.
3. In the left panel, open **Gmail API v1** and select **https://www.googleapis.com/auth/gmail.modify**.
4. Click **Authorize APIs**, sign in with the Gmail account you want to label, and allow.
5. Click **Exchange authorization code for tokens**. Copy the **Refresh token** and set it as `GMAIL_REFRESH_TOKEN` in `.env` and in Trigger.dev.

## 6. Put credentials in the app

- **Local:** run `./scripts/setup-gmail-env.sh` (or `pnpm run setup:gmail`) and paste Client ID, Client Secret, and Refresh token. That updates `.env`.
- **Trigger.dev (deployed runs):** in the Trigger.dev dashboard, open your project → **Environment Variables**, and add `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, and `GMAIL_REFRESH_TOKEN` (and optionally `GMAIL_USER_ID`) for the environment where the tasks run.

After this, the scheduled task and label-one-message runs use the Gmail account that authorized the app.

---

## Troubleshooting

**“Gmail API has not been used in project … before or it is disabled”**

- Enable the Gmail API for that project: open [APIs & Services → Library](https://console.cloud.google.com/apis/library), search for **Gmail API**, open it, and click **Enable**. Or use the link from the error (it includes your project ID). Wait a few minutes after enabling, then retry the task.

**“email-labeler has not completed the Google verification process … can only be accessed by developer-approved testers” / Error 403: access_denied**

- Add your Gmail as a **Test user**: [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent) → **Test users** → **+ ADD USERS** → your address → **Save**.
- When signing in, Google may show an “app isn’t verified” warning; click **Continue** (or **Advanced** → **Go to [app name]**) to proceed.

**“This app doesn’t comply with Google’s OAuth 2.0 policy … register the redirect URI”**

- The redirect URI used by the script is **exactly** `http://127.0.0.1:9999/callback` (no `https`, no `localhost`, no trailing slash).
- In [Google Cloud Console](https://console.cloud.google.com/apis/credentials): open your project → **Credentials** → click your **OAuth 2.0 Client ID** (Web application).
- Under **Authorized redirect URIs**, click **+ ADD URI** and add:
  ```
  http://127.0.0.1:9999/callback
  ```
- Click **Save**, wait a minute if needed, then run `pnpm run get-refresh-token` again.
