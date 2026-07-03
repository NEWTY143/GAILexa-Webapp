import { PublicClientApplication } from '@azure/msal-browser'
import { ConnectionSettings, ScopeHelper } from '@microsoft/agents-copilotstudio-client'
import { appConfig } from './config.js'

let msalInstance = null

export function getConnectionSettings() {
  return new ConnectionSettings({
    appClientId: appConfig.appClientId,
    tenantId: appConfig.tenantId,
    directConnectUrl: appConfig.directConnectUrl,
  })
}

async function getMsal() {
  if (!msalInstance) {
    msalInstance = new PublicClientApplication({
      auth: {
        clientId: appConfig.appClientId,
        authority: `https://login.microsoftonline.com/${appConfig.tenantId}`,
        redirectUri: window.location.origin,
      },
      cache: {
        cacheLocation: 'localStorage',
      },
    })
    await msalInstance.initialize()
  }
  return msalInstance
}

function getScopes() {
  // e.g. "https://api.powerplatform.com/.default"
  return [ScopeHelper.getScopeFromSettings(getConnectionSettings())]
}

/** Returns the signed-in account, or null. */
export async function getAccount() {
  const msal = await getMsal()
  const accounts = msal.getAllAccounts()
  return accounts.length > 0 ? accounts[0] : null
}

/** Interactive sign-in via popup. Returns the account. */
export async function signIn() {
  const msal = await getMsal()
  const result = await msal.loginPopup({
    scopes: getScopes(),
    prompt: 'select_account',
  })
  return result.account
}

/** Acquire an access token for Copilot Studio (silent first, popup fallback). */
export async function acquireToken() {
  const msal = await getMsal()
  const account = (await getAccount()) ?? (await signIn())
  try {
    const result = await msal.acquireTokenSilent({
      scopes: getScopes(),
      account,
    })
    return result.accessToken
  } catch {
    const result = await msal.acquireTokenPopup({ scopes: getScopes(), account })
    return result.accessToken
  }
}

export async function signOut() {
  const msal = await getMsal()
  const account = await getAccount()
  await msal.logoutPopup({ account }).catch(() => {})
}
