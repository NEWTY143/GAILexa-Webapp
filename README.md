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

## Multilingual voice (v1.3.0)

GAILexa understands and speaks eight languages: English, Hindi, Hinglish,
Bengali, Marathi, Telugu, Gujarati and Tamil.

### How a spoken turn flows

1. **Recognise** — Azure AI Speech transcribes the microphone and detects the
   language (two detection passes, because Azure allows four candidates each).
2. **Translate to English** — the transcript is translated so Copilot Studio
   always receives English. The agent, its instructions, its knowledge base and
   the citation system are unchanged.
3. **Answer** — Copilot Studio replies in English; the chat displays English,
   with the person's own words shown beneath their message.
4. **Translate back and speak** — the answer is translated into the language
   the person used and read aloud in that language's female neural voice.

| Language | Locale | Voice |
| --- | --- | --- |
| English | en-IN | Neerja |
| Hindi / Hinglish | hi-IN | Swara |
| Bengali | bn-IN | Tanishaa |
| Marathi | mr-IN | Aarohi |
| Telugu | te-IN | Shruti |
| Gujarati | gu-IN | Dhwani |
| Tamil | ta-IN | Pallavi |

### Server configuration

The Azure key never reaches the browser. Set it on the Windows service:

```
"C:\Program Files\nssm\nssm.exe" set GAILexaVoice AppEnvironmentExtra ^
  AZURE_SPEECH_KEY=<KEY 1 from the Azure resource> ^
  AZURE_SPEECH_REGION=centralindia ^
  HF_HUB_OFFLINE=1
"C:\Program Files\nssm\nssm.exe" restart GAILexaVoice
```

Two endpoints are added to the backend:

- `POST /speech/token` — issues a 10-minute Speech token for the browser SDK
- `POST /translate` — proxies Azure Translator so the key stays server-side

Check with `curl http://127.0.0.1:8000/health` — `azure_speech` should be `true`.

### Turning it off

Set `VITE_AZURE_SPEECH_ENABLED=false` and rebuild: voice falls back to the
previous Whisper + edge-tts path (English and Hindi only). Whisper remains
installed on the server, so the fallback needs no extra work.

### Network

Azure AI Speech runs in the **browser**, so user PCs need outbound HTTPS and
WebSocket access to `*.stt.speech.microsoft.com`, `*.tts.speech.microsoft.com`
and `*.api.cognitive.microsoft.com` for the Central India region. The server
itself only needs `api.cognitive.microsofttranslator.com` for translation.

### Deploying the multilingual version to Render (testing)

The same code runs on Render and on the air-gapped GAIL server — the Whisper
model source is detected automatically (downloaded on Render, sideloaded on the
GAIL server), so no code changes are needed between the two.

**Backend service (`gailexa-whisper`) → Environment:**

| Key | Value |
| --- | --- |
| `AZURE_SPEECH_KEY` | KEY 1 from the Azure AI resource (secret) |
| `AZURE_SPEECH_REGION` | `centralindia` |
| `ALLOWED_ORIGINS` | the frontend URL, e.g. `https://gailexa-web-vmyi.onrender.com` |
| `WHISPER_MODEL` | `tiny` |

**Frontend service (`gailexa-web`) → Environment:**

| Key | Value |
| --- | --- |
| `VITE_WHISPER_URL` | the backend URL, e.g. `https://gailexa-whisper-vmyi.onrender.com` |
| `VITE_AZURE_SPEECH_ENABLED` | `true` |
| `VITE_AZURE_SPEECH_REGION` | `centralindia` |
| `VITE_APP_CLIENT_ID`, `VITE_TENANT_ID`, `VITE_DIRECT_CONNECT_URL` | as before |

Then verify:

```
curl https://<backend>.onrender.com/health
```

`azure_speech` should be `true` and `model_source` should be `downloaded`.

### Direct mode — testing without a backend (v1.3.1)

For a quick test deployment, the browser can call Azure directly and no
backend service is needed at all. Set on the static site:

| Key | Value |
| --- | --- |
| `VITE_AZURE_SPEECH_KEY` | KEY 1 from the Azure resource |
| `VITE_AZURE_SPEECH_REGION` | `centralindia` |

`VITE_WHISPER_URL` is then unused for voice.

**This key is compiled into the JavaScript bundle and can be read by anyone
who opens the browser's developer tools.** Use it only for testing with a
key you are willing to rotate. For production, leave `VITE_AZURE_SPEECH_KEY`
empty and set `AZURE_SPEECH_KEY` on the backend instead — the app then
fetches short-lived tokens from `/speech/token` and the key never leaves the
server.

## Talk mode (v1.4.0)

A second way to use GAILexa: tap the headset button beside the microphone and
a full-screen voice conversation opens. Nothing is written on screen — it is
meant to feel like a phone call.

Each turn runs: **listen (15 s) → translate to English → ask the agent →
translate the answer back → speak it.** While the agent is thinking, a short
holding phrase is spoken in the person's own language so the line is never
silent, and long answers are summarised before being read out. The exchange is
still recorded in the chat, so the history is there on return.

The circle shows what is happening — blue ripples while listening, a yellow
spin while thinking, a green pulse while answering. Tapping it, or the Stop
button, halts whatever is in progress.

### Other voice changes in this version

- Microphone recording extended from 10 to **20 seconds**, using continuous
  recognition so long sentences are no longer cut off mid-way.
- The play button can now be tapped to **cancel** while a summary is being
  prepared, not only once playback has started.
- Microphone permission is now requested explicitly before the Speech SDK
  opens the device, which is what **mobile browsers** require — this fixes the
  case where the button appeared active on a phone but no audio was captured.

### Playback and language controls (v1.5.0)

- **Stop bar.** Whenever an answer is being prepared or read aloud, a small bar
  appears above the message box showing what is happening, with a Stop button.
  Playback can now be halted from anywhere on the page rather than only from
  the button on the message itself.
- **Language selector in talk mode.** The voice screen now has its own language
  control in the top-left corner: auto-detect, or any of the eight languages
  chosen directly. Choosing a language explicitly is more reliable than
  detection in noisy surroundings, such as a plant or control room. Changing it
  stops whatever is in progress and applies from the next question.

### Help and contact (v1.5.1)

A help button sits in the header, beside the user avatar. Clicking it opens a
contact card anchored to the top right, carrying the GAIL tri-colour stripe and
the developer's details — HVJ extension, mobile and email, each one tappable so
a phone dials or the mail client opens directly. The card closes on an outside
click or the Escape key.
