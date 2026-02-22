import { isString } from './util.js';

const Integrations = new Map<string, any>();

const IntegManagerModel = 'integmanager.core';

export async function prepareIntegrations(
  integManagerHost: string,
  username: string | undefined,
  password: string | undefined,
  integConfigObj: object
) {
  const integConfig = new Map(Object.entries(integConfigObj));
  const standardHeaders = await loginToIntegManager(integManagerHost, username, password);
  const keys = [...integConfig.keys()];
  for (let i = 0; i < keys.length; ++i) {
    const configName = keys[i];
    const entry = integConfig.get(configName);
    const configPath = typeof entry === 'string' ? entry : entry?.config;
    if (configPath) {
      const apiUrl = mkApiUrl(integManagerHost, configPath);
      try {
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: standardHeaders,
        });

        if (!response.ok) {
          console.error(
            `Failed to fetch integration for ${configPath}, HTTP error! status: ${response.status} ${response.text} ${response.statusText}`
          );
          continue;
        }

        const data = await response.json();
        if (data.length > 0) {
          const inst: any = data[0].config;
          Integrations.set(configName, inst);
        } else {
          console.error(`Integration not found for ${configPath}`);
        }
      } catch (error: any) {
        console.error(`Error fetching integration for ${configPath}:`, error.message);
      }
    }
  }
}

async function loginToIntegManager(
  host: string,
  username?: string,
  password?: string
): Promise<any> {
  const defaultHdr = { 'Content-Type': 'application/json' };
  if (username && password && username.length > 0) {
    const apiUrl = `${host}/agentlang.auth/login`;
    const data = { email: username, password: password };
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: defaultHdr,
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to login to integration-manager. HTTP error! status: ${response.status}`
      );
    }

    const responseData = await response.json();
    return {
      Authorization: `Bearer ${responseData.id_token}`,
      'Content-Type': 'application/json',
    };
  } else {
    return defaultHdr;
  }
}

function mkApiUrl(integManagerHost: string, configPath: string): string {
  const parts = configPath.split('/');
  const integId = parts[0];
  const configId = parts[1];
  return `${integManagerHost}/${IntegManagerModel}/integration/${integId}/integrationConfig/config/${configId}?tree=true`;
}

export function getIntegrationConfig(name: string, configName: string): any {
  const config: any = Integrations.get(name);
  if (!config) return undefined;
  if (config.parameter == null) return undefined;

  if (config.parameter instanceof Map) {
    return Object.fromEntries(config.parameter).get(configName);
  }
  if (isString(config.parameter)) {
    try {
      return JSON.parse(config.parameter)[configName];
    } catch {
      return undefined;
    }
  }
  if (typeof config.parameter === 'object') {
    return config.parameter[configName];
  }
  return undefined;
}
