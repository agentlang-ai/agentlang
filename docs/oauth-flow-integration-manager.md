# OAuth Flow: Browser, Agentlang App, and Integration Manager

This document describes the OAuth consent flow across the three components involved: the **browser client** (frontend), the **Agentlang app** (your backend), and the **Integration Manager** (credential service).

## Architecture

```
┌──────────────┐      ┌──────────────────┐      ┌─────────────────────┐      ┌──────────────┐
│   Browser    │─────>│  Agentlang App   │─────>│ Integration Manager │─────>│ OAuth        │
│   (Frontend) │<─────│  (Your Backend)  │<─────│ (Credential Svc)    │<─────│ Provider     │
└──────────────┘      └──────────────────┘      └─────────────────────┘      └──────────────┘
```

- **Browser** -- initiates the OAuth flow and handles the redirect callback.
- **Agentlang App** -- proxies OAuth requests to Integration Manager via built-in routes. Also uses tokens at runtime in resolvers.
- **Integration Manager** -- owns all OAuth client credentials, generates authorization URLs, exchanges codes for tokens, stores and refreshes tokens.
- **OAuth Provider** -- the external service (Google, Microsoft, Slack, etc.) that the user authorizes against.

## Prerequisites

1. The Integration Manager is running and has the OAuth client credentials (client ID, client secret, scopes) configured for the provider.
2. Your Agentlang app's `config.al` has an `integrations` section with the provider listed in `connections` and `oauth: true` to enable the proxy routes.

```json
{
  "host": "http://localhost:8085",
  "connections": {
    "google_drive": "google-drive/oauth-config"
  },
  "oauth": true
} @as integrations
```

## The Full OAuth Flow

### Step 1: Browser requests the authorization URL

The browser calls the Agentlang app's OAuth proxy to get the provider's authorization URL.

```
Browser                          Agentlang App                    Integration Manager
  │                                    │                                    │
  │  GET /agentlang/oauth/             │                                    │
  │    authorize-url                   │                                    │
  │    ?provider=google_drive          │                                    │
  │    &redirectUri=http://…/callback  │                                    │
  │───────────────────────────────────>│                                    │
  │                                    │                                    │
  │                                    │  resolve provider key to           │
  │                                    │  integration name:                 │
  │                                    │  "google_drive" config path is     │
  │                                    │  "google-drive/oauth-config"       │
  │                                    │  → integration name: "google-drive"│
  │                                    │                                    │
  │                                    │  GET /integmanager.auth/oauthFlow  │
  │                                    │    ?action=authorize               │
  │                                    │    &integrationName=google-drive   │
  │                                    │    &redirectUri=http://…/callback  │
  │                                    │───────────────────────────────────>│
  │                                    │                                    │
  │                                    │  { authorizationUrl, state }       │
  │                                    │<───────────────────────────────────│
  │                                    │                                    │
  │  { authorizationUrl, state }       │                                    │
  │<───────────────────────────────────│                                    │
```

**Request:**

```
GET /agentlang/oauth/authorize-url?provider=google_drive&redirectUri=http://localhost:3000/callback
```

**Response:**

```json
{
  "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&redirect_uri=...&scope=...&state=abc123&response_type=code",
  "state": "abc123"
}
```

The browser should store the `state` value to verify it in step 3.

### Step 2: User authorizes with the OAuth provider

The browser redirects the user to the `authorizationUrl`. The user sees the provider's consent screen (e.g. "Allow this app to access your Google Drive?") and grants permission.

```
Browser                          OAuth Provider (e.g. Google)
  │                                    │
  │  Redirect to authorizationUrl      │
  │───────────────────────────────────>│
  │                                    │
  │          User sees consent screen  │
  │          User clicks "Allow"       │
  │                                    │
  │  302 Redirect to redirectUri       │
  │    ?code=4/0AX4X...               │
  │    &state=abc123                   │
  │<───────────────────────────────────│
```

The provider redirects back to your `redirectUri` with a `code` and `state` in the query string.

### Step 3: Browser exchanges the code for tokens

The browser sends the authorization code to the Agentlang app, which forwards it to Integration Manager to exchange for tokens.

```
Browser                          Agentlang App                    Integration Manager
  │                                    │                                    │
  │  POST /agentlang/oauth/exchange    │                                    │
  │  {                                 │                                    │
  │    provider: "google_drive",       │                                    │
  │    code: "4/0AX4X...",            │                                    │
  │    state: "abc123"                 │                                    │
  │  }                                 │                                    │
  │───────────────────────────────────>│                                    │
  │                                    │                                    │
  │                                    │  POST /integmanager.auth/oauthFlow │
  │                                    │  {                                 │
  │                                    │    action: "exchange",             │
  │                                    │    integrationName: "google-drive",│
  │                                    │    code: "4/0AX4X...",            │
  │                                    │    state: "abc123"                 │
  │                                    │  }                                 │
  │                                    │───────────────────────────────────>│
  │                                    │                                    │
  │                                    │  Integration Manager exchanges     │
  │                                    │  the code with the OAuth provider, │
  │                                    │  stores the tokens, and returns:   │
  │                                    │                                    │
  │                                    │  { accessToken, refreshToken,      │
  │                                    │    expiresIn, tokenType }          │
  │                                    │<───────────────────────────────────│
  │                                    │                                    │
  │  { accessToken, refreshToken,      │                                    │
  │    expiresIn, tokenType }          │                                    │
  │<───────────────────────────────────│                                    │
```

**Request:**

```
POST /agentlang/oauth/exchange
Content-Type: application/json

{ "provider": "google_drive", "code": "4/0AX4X...", "state": "abc123" }
```

**Response:**

```json
{
  "accessToken": "ya29.a0AfH6SM...",
  "refreshToken": "1//0eXy...",
  "expiresIn": 3599,
  "tokenType": "Bearer"
}
```

At this point, the Integration Manager has stored the tokens. The OAuth connection is established.

### Step 4: Using the tokens at runtime

Once the OAuth flow is complete, tokens can be used in two ways:

#### From the browser -- via the access token route

The browser can request a fresh access token at any time. Integration Manager handles refresh automatically when the token is expired.

```
Browser                          Agentlang App                    Integration Manager
  │                                    │                                    │
  │  GET /agentlang/oauth/             │                                    │
  │    access-token                    │                                    │
  │    ?provider=google_drive          │                                    │
  │───────────────────────────────────>│                                    │
  │                                    │  GET /integmanager.auth/oauthToken │
  │                                    │    ?integrationName=google-drive   │
  │                                    │───────────────────────────────────>│
  │                                    │                                    │
  │                                    │  { accessToken, expiresIn,         │
  │                                    │    tokenType }                     │
  │                                    │<───────────────────────────────────│
  │                                    │                                    │
  │  { accessToken, expiresIn,         │                                    │
  │    tokenType }                     │                                    │
  │<───────────────────────────────────│                                    │
```

#### From resolver code -- via the global API or resolver object

Resolvers call Integration Manager directly through the integration client (no HTTP proxy needed).

**Using `resolver.getAuthHeaders()`** (for resolvers bound to an integration):

```js
export const queryFiles = async (resolver, inst) => {
  const authHeaders = await resolver.getAuthHeaders();
  const response = await fetch('https://www.googleapis.com/drive/v3/files', {
    headers: authHeaders,
  });
  return response.json();
};
```

**Using `agentlang.getAccessToken()`** (for raw token access):

```js
const { accessToken } = await agentlang.getAccessToken('google-drive');
// Pass token to a third-party tool like rclone
```

**Using `agentlang.authFetch()`** (fetch with auto-injected headers):

```js
const response = await agentlang.authFetch(
  'google-drive',
  'https://www.googleapis.com/drive/v3/files'
);
```

## Provider Name Resolution

The config uses **provider keys** (e.g. `google_drive`) as identifiers in the `connections` map. The Integration Manager uses **integration entity names** (e.g. `google-drive`). The Agentlang app resolves between them automatically:

```
connections config:  "google_drive": "google-drive/oauth-config"
                      ^^^^^^^^^^^^   ^^^^^^^^^^^^
                      provider key   integration entity name (extracted from config path)
```

The resolution logic splits the config path on `/` and takes the first segment. This means:

- Browser sends `provider=google_drive` (the key from your config)
- Agentlang resolves it to `google-drive` (the integration entity name)
- Integration Manager receives `integrationName=google-drive`

## Integration Manager Endpoints

These are the Integration Manager endpoints that the Agentlang app calls. You typically don't call these directly -- the built-in proxy routes and global API handle this for you.

| Endpoint                                                                            | Method | Purpose                                                       |
| ----------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------- |
| `/integmanager.auth/oauthFlow?action=authorize&integrationName=...&redirectUri=...` | GET    | Get the OAuth authorization URL                               |
| `/integmanager.auth/oauthFlow`                                                      | POST   | Exchange authorization code for tokens                        |
| `/integmanager.auth/oauthToken?integrationName=...`                                 | GET    | Get current access token (auto-refreshes)                     |
| `/integmanager.auth/authHeaders/{integrationName}`                                  | GET    | Get pre-built auth headers (e.g. `Authorization: Bearer ...`) |
| `/integmanager.auth/authRefresh`                                                    | POST   | Manually trigger a token refresh                              |

## Agentlang Proxy Routes

These routes are available on your Agentlang app when `oauth: true` is set in the integrations config.

| Route                            | Method | Params                             | Proxies to                   |
| -------------------------------- | ------ | ---------------------------------- | ---------------------------- |
| `/agentlang/oauth/authorize-url` | GET    | `provider`, `redirectUri` (query)  | `oauthFlow?action=authorize` |
| `/agentlang/oauth/exchange`      | POST   | `provider`, `code`, `state` (body) | `POST oauthFlow`             |
| `/agentlang/oauth/access-token`  | GET    | `provider` (query)                 | `oauthToken`                 |

## Token Lifecycle

```
1. User completes consent flow
   └─> Integration Manager stores access token + refresh token

2. Token is valid (not expired)
   └─> Requests return the stored access token

3. Token expires
   └─> Integration Manager automatically uses the refresh token
       to get a new access token from the OAuth provider
   └─> New access token is stored and returned

4. Refresh token is revoked or expired
   └─> Requests fail with an error
   └─> User must re-authorize (repeat the consent flow)
```

## Error Handling

| Error                                                    | Cause                                        | Fix                                                                                             |
| -------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `400 provider and redirectUri query params are required` | Missing query parameters on authorize-url    | Include both `provider` and `redirectUri`                                                       |
| `400 Unknown provider: X`                                | Provider key not found in connections config | Check that the key matches your `connections` config exactly                                    |
| `500 Failed to get OAuth authorize URL`                  | Integration Manager rejected the request     | Verify the integration is configured in Integration Manager with valid OAuth client credentials |
| `500 Failed to exchange authorization code`              | Code exchange failed                         | The code may be expired or already used. Restart the flow from step 1                           |
| `500 Failed to get access token`                         | Token retrieval failed                       | The refresh token may be revoked. User needs to re-authorize                                    |

## Example: Frontend OAuth Flow (JavaScript)

```js
// Step 1: Get authorization URL
const authResponse = await fetch(
  '/agentlang/oauth/authorize-url?provider=google_drive&redirectUri=' +
    encodeURIComponent(window.location.origin + '/oauth/callback')
);
const { authorizationUrl, state } = await authResponse.json();

// Save state for verification
sessionStorage.setItem('oauth_state', state);

// Step 2: Redirect user to consent screen
window.location.href = authorizationUrl;

// --- After redirect back to /oauth/callback ---

// Step 3: Exchange code for tokens
const params = new URLSearchParams(window.location.search);
const code = params.get('code');
const returnedState = params.get('state');

// Verify state matches
if (returnedState !== sessionStorage.getItem('oauth_state')) {
  throw new Error('OAuth state mismatch');
}

const tokenResponse = await fetch('/agentlang/oauth/exchange', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    provider: 'google_drive',
    code,
    state: returnedState,
  }),
});
const tokens = await tokenResponse.json();
// Connection is now established. Tokens are stored in Integration Manager.

// Step 4: Later, get a fresh access token when needed
const accessResponse = await fetch('/agentlang/oauth/access-token?provider=google_drive');
const { accessToken } = await accessResponse.json();
```
