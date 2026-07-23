// ---------------------------------------------------------------------------
// GAILexa configuration
//
// Values are read from environment variables (a .env file locally, or the
// environment settings on Render). See .env.example and README.md.
// ---------------------------------------------------------------------------

export const APP_VERSION = '1.3.1'

export const appConfig = {
  // Entra ID (Azure AD) app registration — REQUIRED because the agent uses
  // Microsoft authentication. Create one in the Azure portal (see README).
  appClientId: import.meta.env.VITE_APP_CLIENT_ID || '',
  tenantId: import.meta.env.VITE_TENANT_ID || '',

  // Connection string copied from Copilot Studio → Channels → Web app.
  directConnectUrl:
    import.meta.env.VITE_DIRECT_CONNECT_URL ||
    'https://default288eb95defee416fb87b0470a90e53.e9.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/cree1_TestCHatbot/conversations?api-version=2022-03-01-preview',

  // Optional: URL of the faster-whisper transcription service (server/ folder).
  // When set, voice input uses Whisper (better accuracy + Hindi/English
  // auto-detection). When empty, the browser's Web Speech API is used.
  whisperUrl: import.meta.env.VITE_WHISPER_URL || '',

  // --- Azure AI Speech (multilingual voice) --------------------------------
  // When enabled, voice input and playback use Azure AI Speech + Translator
  // instead of Whisper/edge-tts, giving eight languages instead of two.
  // The Azure key is NEVER placed here — the backend holds it and issues
  // short-lived tokens via /speech/token. Only this switch and the region
  // (used for diagnostics) live in the frontend.
  azureSpeechEnabled:
    String(import.meta.env.VITE_AZURE_SPEECH_ENABLED || '').toLowerCase() === 'true',
  azureSpeechRegion: import.meta.env.VITE_AZURE_SPEECH_REGION || 'centralindia',

  // Direct mode (TESTING ONLY): when a key is supplied here, the browser
  // talks to Azure directly and no backend is needed. The key is compiled
  // into the JavaScript bundle and is readable by anyone who opens the
  // browser's developer tools — so leave this EMPTY in production and let
  // the backend issue short-lived tokens instead.
  azureSpeechKey: import.meta.env.VITE_AZURE_SPEECH_KEY || '',
}

export function validateConfig() {
  const missing = []
  if (!appConfig.appClientId) missing.push('VITE_APP_CLIENT_ID')
  if (!appConfig.tenantId) missing.push('VITE_TENANT_ID')
  if (!appConfig.directConnectUrl) missing.push('VITE_DIRECT_CONNECT_URL')
  return missing
}
