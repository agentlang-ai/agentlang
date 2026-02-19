let host: string | undefined;
let headers: Record<string, string> | undefined;

export function configureIntegrationClient(h: string, hdrs?: Record<string, string>): void {
  host = h;
  headers = hdrs;
}

export function isIntegrationClientConfigured(): boolean {
  return host !== undefined;
}

export async function getIntegrationAuthHeaders(integrationName: string): Promise<Record<string, string>> {
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
  const mergedHeaders = { ...authHeaders, ...(options.headers as Record<string, string> || {}) };
  return fetch(url, { ...options, headers: mergedHeaders });
}
