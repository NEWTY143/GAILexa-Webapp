# GAILexa Web — Copilot Studio chat for GAIL

A React (Vite) web app that hosts your **GAILexa** Copilot Studio agent using the official **Microsoft 365 Agents SDK** and Microsoft sign-in (MSAL).

Because your agent uses **Microsoft authentication**, every user must sign in with a Microsoft work account, and you need one small piece of Azure setup before the app works: an **Entra ID app registration**. This takes ~5 minutes and is free.

---

## Step 1 — Create an Entra ID app registration (one time)

1. Go to https://portal.azure.com → **Microsoft Entra ID** → **App registrations** → **New registration**.
2. Name: `GAILexa Web` (anything works).
3. Supported account types: **Accounts in this organizational directory only**.
4. Redirect URI: choose **Single-page application (SPA)** and enter:
   - `http://localhost:5173` (for local development)
5. Click **Register**.
6. On the app's **Overview** page, copy:
   - **Application (client) ID** → this is `VITE_APP_CLIENT_ID`
   - **Directory (tenant) ID** → this is `VITE_TENANT_ID`
7. Go to **API permissions** → **Add a permission** → **APIs my organization uses** → search for **Power Platform API**:
   - If it doesn't appear, an admin must first register it once (see note below).
   - Select **Delegated permissions** → check **CopilotStudio.Copilots.Invoke** → **Add permissions**.
8. Click **Grant admin consent** (or ask your admin to).

> **If "Power Platform API" doesn't show up:** an admin needs to run this once in PowerShell:
> ```powershell
> Install-Module AzureAD
> Connect-AzureAD
> New-AzureADServicePrincipal -AppId 8578e004-a5c6-46e7-913e-12f58912df43
> ```
> Then retry step 7.

When you later deploy to Render, come back to **Authentication** → add your Render URL (e.g. `https://gailexa-web.onrender.com`) as another SPA redirect URI.

## Step 2 — Run locally

```bash
npm install
cp .env.example .env    # then open .env and paste your client ID + tenant ID
npm run dev
```

Open http://localhost:5173, click **Sign in with Microsoft**, and chat.

The connection string from Copilot Studio is already prefilled in `.env.example`. If you ever republish the agent under a different name/environment, update `VITE_DIRECT_CONNECT_URL`.

## Step 3 — Deploy to Render

**Option A — Blueprint (easiest):**
1. Push this folder to a GitHub repo.
2. On https://render.com → **New** → **Blueprint** → pick your repo (it reads `render.yaml`).
3. When prompted, enter the three environment variables (`VITE_APP_CLIENT_ID`, `VITE_TENANT_ID`, `VITE_DIRECT_CONNECT_URL`).

**Option B — Manual static site:**
1. **New** → **Static Site** → connect the repo.
2. Build command: `npm install && npm run build`
3. Publish directory: `dist`
4. Add the same three environment variables.

**After deploying:** add your Render URL (e.g. `https://gailexa-web.onrender.com`) as a **SPA redirect URI** in the Entra app registration (Step 1), or sign-in will fail with an `AADSTS50011` redirect-URI error.

## How it works

```
Browser ──(MSAL popup)──► Microsoft Entra ID  → access token
Browser ──(token + connection string)──► Copilot Studio (Power Platform API)
        ◄── streamed activities (messages, typing, suggested actions)
```

- `src/auth.js` — MSAL sign-in and token acquisition (the scope is derived automatically from your connection string via `ScopeHelper`).
- `src/copilot.js` — starts the conversation and streams replies using `CopilotStudioClient`.
- `src/components/` — the chat UI (markdown rendering, typing indicator, quick-reply chips).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `AADSTS50011` on sign-in | The page URL isn't a registered SPA redirect URI — add it in Entra → Authentication. |
| `AADSTS65001` / consent error | Admin consent wasn't granted for `CopilotStudio.Copilots.Invoke`. |
| 401/403 after sign-in | The signed-in user may not have access to the agent, or the permission is missing. |
| "Could not reach Copilot Studio" | Check `VITE_DIRECT_CONNECT_URL` matches the Channels → Web app connection string exactly. |
| Popup blocked | Allow popups for the site (sign-in uses a popup window). |
