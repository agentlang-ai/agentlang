let host: string | undefined;
let headers: Record<string, string> | undefined;

export function configureIntegrationClient(h: string, hdrs?: Record<string, string>): void {
  host = h;
  headers = hdrs;
}

export function isIntegrationClientConfigured(): boolean {
  return host !== undefined;
}

export async function getIntegrationAuthHeaders(
  integrationName: string
): Promise<Record<string, string>> {
  if (!host) {
    throw new Error('Integration client not configured — call configureIntegrationClient() first');
  }

  const url = `${host}/integmanager.auth/authHeaders/${encodeURIComponent(integrationName)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to get auth headers for integration "${integrationName}": ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  // The response is either the entity directly or wrapped in an array
  const result = Array.isArray(data) ? data[0] : data;
  return result?.headers ?? {};
}

export async function refreshIntegrationAuth(integrationName: string): Promise<void> {
  if (!host) {
    throw new Error('Integration client not configured — call configureIntegrationClient() first');
  }

  const url = `${host}/integmanager.auth/authRefresh`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ integrationName }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to refresh auth for integration "${integrationName}": ${response.status} ${response.statusText}`
    );
  }
}

export async function integrationAuthFetch(
  integrationName: string,
  url: string | URL,
  options: RequestInit = {}
): Promise<Response> {
  const authHeaders = await getIntegrationAuthHeaders(integrationName);
  const mergedHeaders = { ...authHeaders, ...((options.headers as Record<string, string>) || {}) };
  return fetch(url, { ...options, headers: mergedHeaders });
}

// --- OAuth consent flow helpers ---

export async function getOAuthAuthorizeUrl(
  integrationName: string,
  redirectUri: string
): Promise<{ authorizationUrl: string; state: string }> {
  if (!host) {
    throw new Error('Integration client not configured — call configureIntegrationClient() first');
  }

  const params = new URLSearchParams({
    action: 'authorize',
    integrationName,
    redirectUri,
  });
  const url = `${host}/integmanager.auth/oauthFlow?${params.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to get OAuth authorize URL for "${integrationName}": ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const result = Array.isArray(data) ? data[0] : data;
  return { authorizationUrl: result.authorizationUrl, state: result.state };
}

export async function exchangeOAuthCode(
  integrationName: string,
  code: string,
  state: string
): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; tokenType: string }> {
  if (!host) {
    throw new Error('Integration client not configured — call configureIntegrationClient() first');
  }

  const url = `${host}/integmanager.auth/oauthFlow`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ action: 'exchange', integrationName, code, state }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to exchange OAuth code for "${integrationName}": ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const result = Array.isArray(data) ? data[0] : data;
  return {
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    tokenType: result.tokenType,
  };
}

export async function getIntegrationAccessToken(
  integrationName: string
): Promise<{ accessToken: string; expiresIn: number; tokenType: string }> {
  if (!host) {
    throw new Error('Integration client not configured — call configureIntegrationClient() first');
  }

  const params = new URLSearchParams({ integrationName });
  const url = `${host}/integmanager.auth/oauthToken?${params.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', ...headers },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to get access token for "${integrationName}": ${response.status} ${response.statusText}`
    );
  }

  const data = await response.json();
  const result = Array.isArray(data) ? data[0] : data;
  return {
    accessToken: result.accessToken,
    expiresIn: result.expiresIn,
    tokenType: result.tokenType,
  };
}
