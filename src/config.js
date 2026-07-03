// ---------------------------------------------------------------------------
// GAILexa configuration
//
// Values are read from environment variables (a .env file locally, or the
// environment settings on Render). See .env.example and README.md.
// ---------------------------------------------------------------------------

export const appConfig = {
  // Entra ID (Azure AD) app registration — REQUIRED because the agent uses
  // Microsoft authentication. Create one in the Azure portal (see README).
  appClientId: import.meta.env.VITE_APP_CLIENT_ID || '',
  tenantId: import.meta.env.VITE_TENANT_ID || '',

  // Connection string copied from Copilot Studio → Channels → Web app.
  directConnectUrl:
    import.meta.env.VITE_DIRECT_CONNECT_URL ||
    'https://default288eb95defee416fb87b0470a90e53.e9.environment.api.powerplatform.com/copilotstudio/dataverse-backed/authenticated/bots/cree1_TestCHatbot/conversations?api-version=2022-03-01-preview',
}

export function validateConfig() {
  const missing = []
  if (!appConfig.appClientId) missing.push('VITE_APP_CLIENT_ID')
  if (!appConfig.tenantId) missing.push('VITE_TENANT_ID')
  if (!appConfig.directConnectUrl) missing.push('VITE_DIRECT_CONNECT_URL')
  return missing
}
