# Gmail Resolver

A comprehensive Agentlang resolver for Gmail integration, providing full CRUD operations and real-time subscriptions for emails, labels, and attachments.

## Quick Start

1. **Install dependencies**:
```bash
pnpm install
```

2. **Set environment variables**:

**Option A: Direct Access Token (Testing)**
```bash
export GMAIL_ACCESS_TOKEN="your-access-token-here"
export GMAIL_POLL_INTERVAL_MINUTES="15"  # Optional: Polling interval for subscriptions
export GMAIL_POLL_MINUTES="10"  # Optional: How far back to poll emails (default: 10 minutes)
```

**Option B: OAuth2 Client Credentials (Production)**
```bash
export GMAIL_CLIENT_ID="your-client-id-here"
export GMAIL_CLIENT_SECRET="your-client-secret-here"
export GMAIL_REFRESH_TOKEN="your-refresh-token-here"
export GMAIL_POLL_INTERVAL_MINUTES="15"  # Optional: Polling interval for subscriptions
export GMAIL_POLL_MINUTES="10"  # Optional: How far back to poll emails (default: 10 minutes)
```

3. **Run the resolver**:
```bash
agent run
```

## Environment Variables

The resolver supports two authentication methods:

### Method 1: Direct Access Token (Recommended for testing)

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `GMAIL_ACCESS_TOKEN` | Gmail API access token | - | `ya29.a0AfH6SMC...` |
| `GMAIL_POLL_INTERVAL_MINUTES` | Polling interval for subscriptions | `15` | `10` |
| `GMAIL_POLL_MINUTES` | How far back to poll emails (in minutes) | `10` | `30` |

### Method 2: OAuth2 Client Credentials (Recommended for production)

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `GMAIL_CLIENT_ID` | Google OAuth2 Client ID | - | `123456789.apps.googleusercontent.com` |
| `GMAIL_CLIENT_SECRET` | Google OAuth2 Client Secret | - | `GOCSPX-abcdef123456` |
| `GMAIL_REFRESH_TOKEN` | OAuth2 Refresh Token | - | `1//04abcdef123456` |
| `GMAIL_POLL_INTERVAL_MINUTES` | Polling interval for subscriptions | `15` | `10` |
| `GMAIL_POLL_MINUTES` | How far back to poll emails (in minutes) | `10` | `30` |

### Getting Gmail Credentials

#### For Direct Access Token:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API
4. Create credentials (OAuth 2.0 Client ID)
5. Generate an access token with the required scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.modify`

#### For OAuth2 Client Credentials:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Gmail API
4. Go to **Credentials** → **Create Credentials** → **OAuth 2.0 Client ID**
5. Configure the OAuth consent screen
6. Set up OAuth 2.0 client ID with the following scopes:
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/gmail.send`
   - `https://www.googleapis.com/auth/gmail.modify`
7. Download the credentials and use the client ID, client secret, and refresh token

### OAuth2 Authentication Flow

The resolver automatically handles OAuth2 authentication when using client credentials:

1. **Token Request**: When no direct access token is provided, the resolver makes a POST request to `https://oauth2.googleapis.com/token`
2. **Refresh Token**: Uses `grant_type=refresh_token` with your client ID, secret, and refresh token
3. **Token Caching**: Automatically caches the access token and refreshes it before expiry
4. **Error Handling**: Provides clear error messages if authentication fails

## API Reference

### Emails

#### Create Email
```http
POST /gmail/Email
{
    "from": "sender@example.com",
    "to": "recipient@example.com",
    "subject": "Test Email",
    "body": "This is a test email",
    "headers": "{\"X-Custom-Header\": \"value\"}"
}
```

#### Query Emails
```http
GET /gmail/Email
GET /gmail/Email/{id}
```

#### Update Email (Add/Remove Labels)
```http
PATCH /gmail/Email/{id}
{
    "add_labels": "INBOX,IMPORTANT",
    "remove_labels": "SPAM"
}
```

#### Delete Email
```http
DELETE /gmail/Email/{id}
```

### Labels

#### Create Label
```http
POST /gmail/Label
{
    "name": "My Custom Label",
    "message_list_visibility": "show",
    "label_list_visibility": "labelShow",
    "color": "{\"textColor\": \"#000000\", \"backgroundColor\": \"#ff0000\"}"
}
```

#### Query Labels
```http
GET /gmail/Label
GET /gmail/Label/{id}
```

#### Update Label
```http
PATCH /gmail/Label/{id}
{
    "name": "Updated Label Name",
    "color": "{\"textColor\": \"#ffffff\", \"backgroundColor\": \"#000000\"}"
}
```

#### Delete Label
```http
DELETE /gmail/Label/{id}
```

### Attachments

#### Query Attachment
```http
GET /gmail/Attachments?message_id={messageId}&attachment_id={attachmentId}
```

### Send Email

#### Send Email
```http
POST /gmail/EmailInput
{
    "from": "sender@example.com",
    "to": "recipient@example.com",
    "subject": "Test Email",
    "body": "This is a test email",
    "headers": "{\"X-Custom-Header\": \"value\"}"
}
```

#### Query Sent Email
```http
GET /gmail/EmailSentOutput/{id}
```

### Fetch Attachment

#### Fetch Attachment Data
```http
GET /gmail/DocumentInput?thread_id={threadId}&attachment_id={attachmentId}
```

## Data Models

### Email
- `id`: String (unique identifier)
- `sender`: String (from address)
- `recipients`: String (to addresses)
- `date`: String (ISO date string)
- `subject`: String (email subject)
- `body`: String (email body content)
- `thread_id`: String (Gmail thread ID)
- `attachments`: Attachments (array of attachment objects)

### Label
- `id`: String (unique identifier)
- `name`: String (label name)
- `message_list_visibility`: String (show/hide in message list)
- `label_list_visibility`: String (show/hide in label list)
- `type`: String (label type)
- `messages_total`: Number (total messages with this label)
- `messages_unread`: Number (unread messages with this label)
- `threads_total`: Number (total threads with this label)
- `threads_unread`: Number (unread threads with this label)
- `color`: LabelColor (label color settings)

### Attachments
- `filename`: String (attachment filename)
- `mime_type`: String (MIME type)
- `size`: Number (file size in bytes)
- `attachment_id`: String (Gmail attachment ID)

## Subscriptions

The resolver supports real-time subscriptions for:
- **Emails**: Polls for new emails and updates
- **Labels**: Monitors label changes and updates

### Email Polling Configuration

When polling for emails, the resolver uses Gmail's search API to fetch emails from a specific time window:

- **`GMAIL_POLL_MINUTES`**: Controls how far back in time to poll emails (default: 10 minutes)
  - The resolver calculates a timestamp for N minutes ago and uses Gmail's `after:` search query
  - Only emails received after this timestamp will be included in the subscription
  - Example: If set to `30`, it will poll emails from the last 30 minutes

- **`GMAIL_POLL_INTERVAL_MINUTES`**: Controls how often to poll for new emails (default: 15 minutes)
  - This determines the frequency of subscription checks
  - Example: If set to `5`, it will check for new emails every 5 minutes

**Example Configuration:**
```bash
# Poll emails from the last 30 minutes, check every 5 minutes
export GMAIL_POLL_MINUTES="30"
export GMAIL_POLL_INTERVAL_MINUTES="5"
```

## Error Handling

The resolver provides comprehensive error handling:
- **Authentication Errors**: Clear messages for OAuth2 failures
- **API Errors**: Detailed error information from Gmail API
- **Network Errors**: Timeout and connection error handling
- **Validation Errors**: Input validation with helpful messages

## Logging

All operations are logged with the `GMAIL RESOLVER:` prefix:
- Request/response logging
- Error logging with context
- Subscription activity logging
- Authentication status logging

## Security

- **Token Management**: Secure token caching and refresh
- **Environment Variables**: Sensitive data stored in environment variables
- **HTTPS Only**: All API calls use HTTPS
- **Scope Validation**: Proper OAuth2 scope validation

## Setup

1. **Clone the repository**:
```bash
git clone <repository-url>
cd gmail
```

2. **Install dependencies**:
```bash
pnpm install
```

3. **Set environment variables**:
```bash
export GMAIL_CLIENT_ID="your-client-id"
export GMAIL_CLIENT_SECRET="your-client-secret"
export GMAIL_REFRESH_TOKEN="your-refresh-token"
```

4. **Run the resolver**:
```bash
agent run
```
