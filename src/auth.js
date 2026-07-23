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

/**
 * Remove MSAL's "interaction in progress" flags. A sign-in that was
 * interrupted (popup closed, page reloaded mid-login) leaves these behind
 * and blocks every future attempt with `interaction_in_progress`.
 */
function clearStaleInteraction() {
  try {
    for (const store of [sessionStorage, localStorage]) {
      for (const key of Object.keys(store)) {
        if (key.includes('interaction.status')) store.removeItem(key)
      }
    }
  } catch {
    /* storage unavailable — nothing to clear */
  }
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
    // Completes a sign-in that returned via redirect (no-op otherwise).
    // Also clears MSAL's in-progress state after a successful round trip.
    try {
      await msalInstance.handleRedirectPromise()
    } catch (e) {
      console.warn('Redirect handling:', e)
      clearStaleInteraction()
    }
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

/**
 * Interactive sign-in via full-page redirect (reliable on mobile, where
 * popups are often blocked). The page navigates to Microsoft's login and
 * returns here; the account is then picked up by getAccount() on load.
 */
export async function signIn() {
  const msal = await getMsal()
  clearStaleInteraction() // never let a stuck flag block a fresh attempt
  await msal.loginRedirect({
    scopes: getScopes(),
    prompt: 'select_account',
  })
  return null // unreachable in practice — the page navigates away
}

/** Acquire an access token for Copilot Studio (silent first, redirect fallback). */
export async function acquireToken() {
  const msal = await getMsal()
  const account = await getAccount()
  if (!account) {
    await signIn()
    return null
  }
  try {
    const result = await msal.acquireTokenSilent({
      scopes: getScopes(),
      account,
    })
    return result.accessToken
  } catch {
    clearStaleInteraction()
    await msal.acquireTokenRedirect({ scopes: getScopes(), account })
    return null // page navigates away
  }
}

export async function signOut() {
  const msal = await getMsal()
  const account = await getAccount()
  clearStaleInteraction()
  await msal.logoutRedirect({ account }).catch(() => {})
}
