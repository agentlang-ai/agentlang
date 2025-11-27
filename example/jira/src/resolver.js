const al_api = await import(`${process.cwd()}/node_modules/agentlang/out/runtime/api.js`);

const makeInstance = al_api.makeInstance;

function asInstance(entity, entityType) {
  const instanceMap = new Map(Object.entries(entity));
  return makeInstance('jira', entityType, instanceMap);
}

const getResponseBody = async response => {
  try {
    const s = await response.text();
    if (s && s.length > 0) {
      try {
        return JSON.parse(s);
      } catch (reason) {
        console.log(reason);
        return s;
      }
    } else {
      return '';
    }
  } catch (error) {
    console.error('JIRA RESOLVER: Error reading response body:', error);
    return {};
  }
};

// Jira API configuration and authentication
let cloudId = null;
let baseUrl = null;
let accessToken = null;
let tokenExpiry = null;

async function getCloudData() {
  if (cloudId && baseUrl) {
    return { cloudId, baseUrl };
  }

  cloudId = process.env.JIRA_CLOUD_ID;
  baseUrl = process.env.JIRA_BASE_URL;

  if (!cloudId || !baseUrl) {
    throw new Error('Jira configuration is required: JIRA_CLOUD_ID and JIRA_BASE_URL');
  }

  console.log(`JIRA RESOLVER: Using cloud ID: ${cloudId}, base URL: ${baseUrl}`);
  return { cloudId, baseUrl };
}

async function getAccessToken() {
  // Return cached token if still valid
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const directToken = process.env.JIRA_ACCESS_TOKEN;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraApiToken = process.env.JIRA_API_TOKEN;
  const clientId = process.env.JIRA_CLIENT_ID;
  const clientSecret = process.env.JIRA_CLIENT_SECRET;

  // Method 1: Direct access token
  if (directToken) {
    accessToken = directToken;
    console.log('JIRA RESOLVER: Using direct access token');
    return accessToken;
  }

  // Method 2: API token authentication (simplest)
  if (jiraEmail && jiraApiToken) {
    accessToken = `${jiraEmail}:${jiraApiToken}`;
    console.log('JIRA RESOLVER: Using API token authentication');
    return accessToken;
  }

  // Method 3: OAuth2 client credentials
  if (clientId && clientSecret) {
    try {
      const tokenUrl = 'https://auth.atlassian.com/oauth/token';
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: 'api.atlassian.com',
      });

      console.log(`JIRA RESOLVER: Fetching OAuth2 access token from ${tokenUrl}`);

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OAuth2 token request failed: ${response.status} - ${errorText}`);
      }

      const tokenData = await response.json();

      if (!tokenData.access_token) {
        throw new Error('No access token received from Jira OAuth2');
      }

      accessToken = tokenData.access_token;
      // Set expiry time (subtract 5 minutes for safety)
      tokenExpiry = Date.now() + ((tokenData.expires_in || 3600) - 300) * 1000;

      console.log(
        `JIRA RESOLVER: Successfully obtained OAuth2 access token, expires in ${tokenData.expires_in} seconds`
      );
      return accessToken;
    } catch (error) {
      console.error(`JIRA RESOLVER: OAuth2 failed: ${error.message}`);
      throw new Error(`Jira OAuth2 authentication failed: ${error.message}`);
    }
  }

  throw new Error(
    'Jira authentication is required: JIRA_ACCESS_TOKEN, API token (JIRA_EMAIL, JIRA_API_TOKEN), or OAuth2 credentials (JIRA_CLIENT_ID, JIRA_CLIENT_SECRET)'
  );
}

// Generic HTTP functions
const makeRequest = async (endpoint, options = {}) => {
  const cd = await getCloudData();
  const baseUrl = cd.baseUrl;
  let token = process.env.JIRA_ACCESS_TOKEN;

  // If no direct token provided, try to get one via OAuth2 or API token
  if (!token) {
    try {
      token = await getAccessToken();
    } catch (error) {
      throw new Error(`Jira authentication failed: ${error.message}`);
    }
  }

  if (!token) {
    throw new Error('Jira access token is required');
  }

  const url = `${baseUrl}${endpoint}`;

  // Determine if token is Bearer (OAuth2) or Basic (API token)
  const isBearerToken = !token.includes(':') && token.length > 50; // OAuth2 tokens are longer and don't contain colons
  let authHeader;

  if (isBearerToken) {
    authHeader = `Bearer ${token}`;
  } else {
    // For API token (email:token format), use Basic auth with base64 encoding
    authHeader = `Basic ${Buffer.from(token).toString('base64')}`;
  }

  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader,
      Accept: 'application/json',
      'X-Atlassian-Token': 'no-check',
    },
  };

  console.log(
    `JIRA RESOLVER: making http request ${
      options.method
    } ${url} with options ${JSON.stringify(options)}`
  );

  const config = { ...defaultOptions, ...options };

  // Remove Content-Type header for GET requests without body
  if (config.method === 'GET') {
    delete config.headers['Content-Type'];
  }

  const timeoutMs = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.error(
      `JIRA RESOLVER: Request timeout after ${timeoutMs}ms - ${url} - ${JSON.stringify(options)}`
    );
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...config,
      signal: controller.signal,
    });

    const body = await getResponseBody(response);
    console.log(`JIRA RESOLVER: response ${response.status} ${response.ok}`, body);

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(
        `JIRA RESOLVER: HTTP Error ${response.status} - ${url} - ${JSON.stringify(options)}`
      );
      throw new Error(`HTTP Error: ${response.status} - ${JSON.stringify(body)}`);
    }

    return body;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      console.error(`JIRA RESOLVER: Request timeout - ${url} - ${JSON.stringify(options)}`);
    } else if (
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'EHOSTUNREACH'
    ) {
      console.error(
        `JIRA RESOLVER: Network unreachable (${error.code}) - ${url} - ${JSON.stringify(options)}`
      );
    } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      console.error(
        `JIRA RESOLVER: Connection error (${error.code}) - ${url} - ${JSON.stringify(options)}`
      );
    } else {
      console.error(
        `JIRA RESOLVER: Request failed (${error.name}) - ${url} - ${JSON.stringify(options)}`
      );
    }

    throw error;
  }
};

const makeGetRequest = async endpoint => {
  console.log(`JIRA RESOLVER: Querying Jira: ${endpoint}\n`);
  return await makeRequest(endpoint, { method: 'GET' });
};

const makePostRequest = async (endpoint, body) => {
  console.log(`JIRA RESOLVER: Creating in Jira: ${endpoint}\n`);
  return await makeRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

const makePutRequest = async (endpoint, body) => {
  console.log(`JIRA RESOLVER: Updating in Jira: ${endpoint}\n`);
  return await makeRequest(endpoint, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
};

const makeDeleteRequest = async endpoint => {
  console.log(`JIRA RESOLVER: Deleting from Jira: ${endpoint}\n`);
  return await makeRequest(endpoint, { method: 'DELETE' });
};

// Issue functions
export const createIssue = async (env, attributes) => {
  const summary = attributes.attributes.get('summary');
  const description = attributes.attributes.get('description');
  const assignee = attributes.attributes.get('assignee');
  const labels = attributes.attributes.get('labels');
  const project = attributes.attributes.get('project');
  const issueType = attributes.attributes.get('issue_type');

  if (!summary || !project || !issueType) {
    return {
      result: 'error',
      message: 'Summary, project, and issue_type are required',
    };
  }

  const { cloudId } = await getCloudData();

  const fields = {
    summary,
    project: { key: project },
    issuetype: { name: issueType },
  };

  if (description) {
    fields.description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: description,
            },
          ],
        },
      ],
    };
  }

  if (assignee) {
    fields.assignee = { accountId: assignee };
  }

  if (labels) {
    fields.labels = labels.split(',').map(label => label.trim());
  }

  const data = { fields };

  try {
    const result = await makePostRequest(`/ex/jira/${cloudId}/rest/api/3/issue`, data);
    return asInstance(
      {
        id: result.id,
        key: result.key,
        self: result.self,
      },
      'Issue'
    );
  } catch (error) {
    console.error(`JIRA RESOLVER: Failed to create issue: ${error}`);
    return { result: 'error', message: error.message };
  }
};

function toIssue(issue, baseUrl) {
  const fields = issue.fields || {};
  const project = fields.project || {};
  const assignee = fields.assignee || {};
  const status = fields.status || {};
  const issueType = fields.issuetype || {};
  const comments = fields.comment?.comments || [];
  const desc = fields.description?.content
    .map(entry => {
      return entry.content
        .map(c => {
          return c.text;
        })
        .join(' ');
    })
    .join('\n');
  const labels = fields.labels?.join(',');
  return {
    id: issue.id,
    created_at: fields.created,
    updated_at: fields.updated,
    key: issue.key,
    summary: fields.summary || '',
    issue_type: issueType.name || '',
    status: status.name || '',
    assignee: assignee.displayName || null,
    url: issue.self,
    web_url: `${baseUrl}/browse/${issue.key}`,
    project_id: project.id || '',
    project_key: project.key || '',
    project_name: project.name || '',
    description: desc || '',
    labels: labels || '',
    comments: comments.length > 0 ? comments.map(comment => toComment(comment)) : null,
  };
}

function toComment(comment) {
  const author = comment.author || {};
  return {
    id: comment.id,
    created_at: comment.created,
    updated_at: comment.updated,
    author: {
      account_id: author.accountId || '',
      active: author.active || false,
      display_name: author.displayName || '',
      email_address: author.emailAddress || '',
    },
    body: comment.body ? JSON.stringify(comment.body) : '',
  };
}

async function queryIssueById(id) {
  console.log(`JIRA RESOLVER: Querying Jira: ${id}\n`);
  try {
    const { cloudId, baseUrl } = await getCloudData();

    if (id) {
      const issue = await makeGetRequest(`/rest/api/3/issue/${id}?expand=comments`);
      const mappedData = toIssue(issue, baseUrl);
      return [asInstance(mappedData, 'Issue')];
    } else {
      // Get all issues using JQL
      const jql = 'ORDER BY updated DESC';
      const issues = await makeGetRequest(
        `/ex/jira/${cloudId}/rest/api/3/search?jql=${encodeURIComponent(
          jql
        )}&maxResults=100&expand=comments`
      );
      return issues.issues.map(issue => {
        const mappedData = toIssue(issue, baseUrl);
        return asInstance(mappedData, 'Issue');
      });
    }
  } catch (error) {
    console.error(`JIRA RESOLVER: Failed to query issues: ${error}`);
    return { result: 'error', message: error.message };
  }
}

export const queryIssue = async (env, attrs) => {
  let id = attrs.queryAttributeValues?.get('id');
  if (!id) {
    id = attrs.queryAttributeValues?.get('__path__')?.split('/')?.pop() ?? null;
  }
  return await queryIssueById(id);
};

export const updateIssue = async (env, attributes, newAttrs) => {
  const id = attributes.attributes.get('id');
  if (!id) {
    return { result: 'error', message: 'Issue ID is required' };
  }

  await getCloudData();

  const fields = {};
  if (newAttrs.get('summary')) {
    fields.summary = newAttrs.get('summary');
  }
  if (newAttrs.get('description')) {
    fields.description = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: newAttrs.get('description'),
            },
          ],
        },
      ],
    };
  }
  if (newAttrs.get('assignee')) {
    fields.assignee = { accountId: newAttrs.get('assignee') };
  }
  if (newAttrs.get('labels')) {
    fields.labels = newAttrs.get('labels').split(',');
  }

  const data = { fields };

  try {
    const result = await makePutRequest(`/rest/api/3/issue/${id}`, data);
    return asInstance({ id: result.id }, 'Issue');
  } catch (error) {
    console.error(`JIRA RESOLVER: Failed to update issue: ${error}`);
    return { result: 'error', message: error.message };
  }
};

export const deleteIssue = async (env, attributes) => {
  const id = attributes.attributes.get('id');
  if (!id) {
    return { result: 'error', message: 'Issue ID is required' };
  }

  const { cloudId } = await getCloudData();

  try {
    await makeDeleteRequest(`/ex/jira/${cloudId}/rest/api/3/issue/${id}`);
    return { result: 'success' };
  } catch (error) {
    console.error(`JIRA RESOLVER: Failed to delete issue: ${error}`);
    return { result: 'error', message: error.message };
  }
};

const processedIssueIds = new Set();

// Subscription functions for real-time updates
async function getAndProcessRecords(resolver, entityType) {
  try {
    await getCloudData();
    let endpoint;
    let nextPageToken;

    while (true) {
      switch (entityType) {
        case 'issues':
          endpoint = `/rest/api/3/search/jql?jql=updated%20%3E%3D%20%22-1d%22%20ORDER%20BY%20updated%20DESC&maxResults=5`;
          if (nextPageToken) {
            endpoint = `${endpoint}&nextPageToken=${nextPageToken}`;
            nextPageToken = undefined;
          }
          break;
        default:
          console.error(`JIRA RESOLVER: Unknown entity type: ${entityType}`);
          return;
      }

      const result = await makeGetRequest(endpoint);

      if (entityType === 'issues' && result.issues) {
        for (const issue of result.issues) {
          if (!processedIssueIds.has(issue.id)) {
            console.log(`JIRA RESOLVER: Processing issue ${issue.id}`);
            const issueInsts = await queryIssueById(issue.id);
            if (issueInsts.length > 0) {
              await resolver.onSubscription(issueInsts[0], true);
              processedIssueIds.add(issue.id);
            }
          }
        }
        if (result.nextPageToken) {
          nextPageToken = result.nextPageToken;
          continue;
        }
      }
      break;
    }
  } catch (error) {
    console.error(`JIRA RESOLVER: Failed to process ${entityType} records: ${error}`);
  }
}

async function handleSubsIssues(resolver) {
  console.log('JIRA RESOLVER: Fetching issues for subscription...');
  await getAndProcessRecords(resolver, 'issues');
}

export async function subsIssues(resolver) {
  await handleSubsIssues(resolver);
  const intervalMinutes = parseInt(process.env.JIRA_POLL_INTERVAL_MINUTES) || 5;
  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`JIRA RESOLVER: Setting issues polling interval to ${intervalMinutes} minutes`);
  setInterval(async () => {
    await handleSubsIssues(resolver);
  }, intervalMs);
}
