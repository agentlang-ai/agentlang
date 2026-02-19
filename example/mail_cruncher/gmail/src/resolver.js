// Import agentlang modules
import { makeInstance } from 'agentlang/out/runtime/module.js';
import { getLocalEnv } from 'agentlang/out/runtime/auth/defs.js';
import { createSubscriptionEnvelope } from 'agentlang/out/runtime/resolvers/interface.js';

// Mapper functions for Gmail API responses to Agentlang entities
function toEmail(messageDetail, headers) {
  const parts = messageDetail.payload?.parts || [];
  const bodyObj = { body: '' };
  const attachments = [];

  if (parts.length > 0) {
    processParts(parts, bodyObj, attachments);
  } else if (messageDetail.payload?.body?.data) {
    // Handle simple API-sent emails with direct body data
    bodyObj.body = Buffer.from(messageDetail.payload.body.data, 'base64').toString('utf8');
  } else if (messageDetail.snippet) {
    bodyObj.body = messageDetail.snippet;
  }

  return {
    id: messageDetail.id,
    sender: headers['From'],
    recipients: headers['To'],
    date: new Date(parseInt(messageDetail.internalDate)).toISOString(),
    subject: headers['Subject'],
    body: bodyObj.body,
    thread_id: messageDetail.threadId,
    attachments: attachments.length > 0 ? attachments : null,
  };
}

function toLabel(label) {
  return {
    id: label.id,
    name: label.name,
    message_list_visibility: label.messageListVisibility,
    label_list_visibility: label.labelListVisibility,
    type: label.type,
    messages_total: label.messagesTotal,
    messages_unread: label.messagesUnread,
    threads_total: label.threadsTotal,
    threads_unread: label.threadsUnread,
    color: label.color
      ? {
          text_color: label.color.textColor,
          background_color: label.color.backgroundColor,
        }
      : null,
  };
}

function processParts(parts, bodyObj, attachments) {
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data && !bodyObj.body) {
      bodyObj.body = Buffer.from(part.body.data, 'base64').toString('utf8');
    } else if (part.mimeType === 'text/html' && part.body?.data && !bodyObj.body) {
      bodyObj.body = Buffer.from(part.body.data, 'base64').toString('utf8');
    } else if (part.filename && part.body?.attachmentId) {
      if (part.mimeType && part.body?.size !== undefined && part.body?.size !== null) {
        attachments.push({
          filename: part.filename,
          mime_type: part.mimeType,
          size: part.body.size,
          attachment_id: part.body.attachmentId,
        });
      }
    }
    if (part.parts?.length) {
      processParts(part.parts, bodyObj, attachments);
    }
  }
}

function asInstance(entity, entityType) {
  const instanceMap = new Map(Object.entries(entity));
  return makeInstance('gmail', entityType, instanceMap);
}

const getResponseBody = async response => {
  try {
    try {
      return await response.json();
    } catch (e) {
      return await response.text();
    }
  } catch (error) {
    console.error('GMAIL RESOLVER: Error reading response body:', error);
    return {};
  }
};

// OAuth2 token management
let accessToken = null;
let tokenExpiry = null;

async function getAccessToken() {
  // Return cached token if still valid
  if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const clientId = getLocalEnv('GMAIL_CLIENT_ID');
  const clientSecret = getLocalEnv('GMAIL_CLIENT_SECRET');
  const refreshToken = getLocalEnv('GMAIL_REFRESH_TOKEN');

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Gmail OAuth2 configuration is required: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN'
    );
  }

  try {
    const tokenUrl = 'https://oauth2.googleapis.com/token';
    const params = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

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
      throw new Error('No access token received from Gmail OAuth2');
    }

    accessToken = tokenData.access_token;
    // Set expiry time (subtract 5 minutes for safety)
    tokenExpiry = Date.now() + ((tokenData.expires_in || 3600) - 300) * 1000;

    return accessToken;
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to get access token: ${error}`);
    throw error;
  }
}

// Generic HTTP functions
const makeRequest = async (endpoint, options = {}) => {
  let token = getLocalEnv('GMAIL_ACCESS_TOKEN');

  // If no direct token provided, try to get one via OAuth2
  if (!token) {
    try {
      token = await getAccessToken();
    } catch (error) {
      throw new Error(`Gmail authentication failed: ${error.message}`);
    }
  }

  if (!token) {
    throw new Error('Gmail access token is required');
  }

  const baseUrl = 'https://gmail.googleapis.com';
  const url = `${baseUrl}${endpoint}`;
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  };

  const config = { ...defaultOptions, ...options };

  // Remove Content-Type header for GET requests without body
  if (config.method === 'GET') {
    delete config.headers['Content-Type'];
  }

  const timeoutMs = 30000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    console.error(
      `GMAIL RESOLVER: Request timeout after ${timeoutMs}ms - ${url} - ${JSON.stringify(options)}`
    );
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...config,
      signal: controller.signal,
    });

    const body = await getResponseBody(response);

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(
        `GMAIL RESOLVER: HTTP Error ${response.status} - ${url} - ${JSON.stringify(options)}`
      );
      throw new Error(`HTTP Error: ${response.status} - ${JSON.stringify(body)}`);
    }

    return body;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      console.error(`GMAIL RESOLVER: Request timeout - ${url} - ${JSON.stringify(options)}`);
    } else if (
      error.code === 'ENOTFOUND' ||
      error.code === 'ECONNREFUSED' ||
      error.code === 'EHOSTUNREACH'
    ) {
      console.error(
        `GMAIL RESOLVER: Network unreachable (${error.code}) - ${url} - ${JSON.stringify(options)}`
      );
    } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      console.error(
        `GMAIL RESOLVER: Connection error (${error.code}) - ${url} - ${JSON.stringify(options)}`
      );
    } else {
      console.error(
        `GMAIL RESOLVER: Request failed (${error.name}) - ${url} - ${JSON.stringify(options)}`
      );
    }

    throw error;
  }
};

const makeGetRequest = async endpoint => {
  return await makeRequest(endpoint, { method: 'GET' });
};

const makePostRequest = async (endpoint, body) => {
  return await makeRequest(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
  });
};

const makePatchRequest = async (endpoint, body) => {
  return await makeRequest(endpoint, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
};

const makeDeleteRequest = async endpoint => {
  return await makeRequest(endpoint, { method: 'DELETE' });
};

// Email functions
export const createEmail = async (env, attributes) => {
  const from = attributes.attributes.get('sender');
  const to = attributes.attributes.get('recipients');
  const subject = attributes.attributes.get('subject');
  const body = attributes.attributes.get('body');
  const headers = attributes.attributes.get('headers');
  const threadId = attributes.attributes.get('thread_id');

  let headerString = '';
  if (headers) {
    try {
      const headerObj = JSON.parse(headers);
      Object.entries(headerObj).forEach(([key, value]) => {
        headerString += `${key}: ${value}\n`;
      });
    } catch (e) {
      console.warn('GMAIL RESOLVER: Invalid headers format, ignoring');
    }
  }

  const email = `From: ${from}\nTo: ${to}\n${headerString}Subject: ${subject}\n\n${body}`;
  const base64EncodedEmail = Buffer.from(email).toString('base64');

  try {
    const requestBody = { raw: base64EncodedEmail };
    if (threadId) {
      requestBody.threadId = threadId;
    }

    const result = await makePostRequest('/gmail/v1/users/me/messages/send', requestBody);
    return { result: 'success', id: result.id, thread_id: result.threadId };
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to create email: ${error}`);
    return { result: 'error', message: error.message };
  }
};

export const queryEmail = async (env, attrs) => {
  const id = attrs.queryAttributeValues?.get('__path__')?.split('/')?.pop() ?? null;

  try {
    let inst;
    if (id) {
      const messageDetail = await makeGetRequest(`/gmail/v1/users/me/messages/${id}`);
      const headers =
        messageDetail.payload?.headers?.reduce((acc, current) => {
          return {
            ...acc,
            [current.name]: current.value,
          };
        }, {}) || {};
      const mappedData = toEmail(messageDetail, headers);
      return [asInstance(mappedData, 'Email')];
    } else {
      // Get list of messages
      const response = await makeGetRequest('/gmail/v1/users/me/messages?maxResults=100');
      const messageList = response.messages || [];
      const emails = [];

      for (const message of messageList) {
        const messageDetail = await makeGetRequest(`/gmail/v1/users/me/messages/${message.id}`);
        const headers =
          messageDetail.payload?.headers?.reduce((acc, current) => {
            return {
              ...acc,
              [current.name]: current.value,
            };
          }, {}) || {};
        const mappedData = toEmail(messageDetail, headers);
        emails.push(asInstance(mappedData, 'Email'));
      }
      return emails;
    }
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to query emails: ${error}`);
    return { result: 'error', message: error.message };
  }
};

export const updateEmail = async (env, attributes, newAttrs) => {
  const id = attributes.attributes.get('id');
  if (!id) {
    return { result: 'error', message: 'Email ID is required for update' };
  }

  // Gmail doesn't support updating emails directly, but we can add/remove labels
  const addLabels = newAttrs.get('add_labels');
  const removeLabels = newAttrs.get('remove_labels');

  try {
    const data = {};
    if (addLabels) {
      data.addLabelIds = addLabels.split(',').map(label => label.trim());
    }
    if (removeLabels) {
      data.removeLabelIds = removeLabels.split(',').map(label => label.trim());
    }

    if (Object.keys(data).length === 0) {
      return {
        result: 'error',
        message: 'No valid update operations provided',
      };
    }

    const result = await makePostRequest(`/gmail/v1/users/me/messages/${id}/modify`, data);
    return asInstance({ id: result.id }, 'Email');
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to update email: ${error}`);
    return { result: 'error', message: error.message };
  }
};

export const deleteEmail = async (env, attributes) => {
  const id = attributes.attributes.get('id');
  if (!id) {
    return { result: 'error', message: 'Email ID is required for deletion' };
  }

  try {
    await makeDeleteRequest(`/gmail/v1/users/me/messages/${id}`);
    return { result: 'success' };
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to delete email: ${error}`);
    return { result: 'error', message: error.message };
  }
};

// Label functions
export const createLabel = async (env, attributes) => {
  const data = {
    name: attributes.attributes.get('name'),
    messageListVisibility: attributes.attributes.get('message_list_visibility') || 'show',
    labelListVisibility: attributes.attributes.get('label_list_visibility') || 'labelShow',
    color: attributes.attributes.get('color')
      ? JSON.parse(attributes.attributes.get('color'))
      : undefined,
  };

  try {
    const result = await makePostRequest('/gmail/v1/users/me/labels', data);
    return { result: 'success', id: result.id };
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to create label: ${error}`);
    return { result: 'error', message: error.message };
  }
};

export const queryLabel = async (env, attrs) => {
  const id = attrs.queryAttributeValues?.get('__path__')?.split('/')?.pop() ?? null;

  try {
    let inst;
    if (id) {
      inst = await makeGetRequest(`/gmail/v1/users/me/labels/${id}`);
    } else {
      inst = await makeGetRequest('/gmail/v1/users/me/labels');
      inst = inst.labels || [];
    }
    if (!(inst instanceof Array)) {
      inst = [inst];
    }
    return inst.map(data => {
      const mappedData = toLabel(data);
      return asInstance(mappedData, 'Label');
    });
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to query labels: ${error}`);
    return { result: 'error', message: error.message };
  }
};

export const updateLabel = async (env, attributes, newAttrs) => {
  const id = attributes.attributes.get('id');
  if (!id) {
    return { result: 'error', message: 'Label ID is required for update' };
  }

  const data = {};
  if (newAttrs.get('name')) {
    data.name = newAttrs.get('name');
  }
  if (newAttrs.get('message_list_visibility')) {
    data.messageListVisibility = newAttrs.get('message_list_visibility');
  }
  if (newAttrs.get('label_list_visibility')) {
    data.labelListVisibility = newAttrs.get('label_list_visibility');
  }
  if (newAttrs.get('color')) {
    data.color = JSON.parse(newAttrs.get('color'));
  }

  try {
    const result = await makePatchRequest(`/gmail/v1/users/me/labels/${id}`, data);
    return asInstance(toLabel(result), 'Label');
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to update label: ${error}`);
    return { result: 'error', message: error.message };
  }
};

export const deleteLabel = async (env, attributes) => {
  const id = attributes.attributes.get('id');
  if (!id) {
    return { result: 'error', message: 'Label ID is required for deletion' };
  }

  try {
    await makeDeleteRequest(`/gmail/v1/users/me/labels/${id}`);
    return { result: 'success' };
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to delete label: ${error}`);
    return { result: 'error', message: error.message };
  }
};

// Attachment functions
export const queryAttachments = async (env, attrs) => {
  const messageId = attrs.queryAttributeValues?.get('message_id');
  const attachmentId = attrs.queryAttributeValues?.get('attachment_id');

  if (!messageId || !attachmentId) {
    return {
      result: 'error',
      message: 'Message ID and Attachment ID are required',
    };
  }

  try {
    const result = await makeGetRequest(
      `/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`
    );
    return asInstance(
      {
        data: result.data,
        size: result.size,
      },
      'Attachments'
    );
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to query attachment: ${error}`);
    return { result: 'error', message: error.message };
  }
};

// Send email function
export const sendEmail = async (env, attributes) => {
  const from = attributes.attributes.get('from');
  const to = attributes.attributes.get('to');
  const subject = attributes.attributes.get('subject');
  const body = attributes.attributes.get('body');
  const headers = attributes.attributes.get('headers');

  let headerString = '';
  if (headers) {
    try {
      const headerObj = JSON.parse(headers);
      Object.entries(headerObj).forEach(([key, value]) => {
        headerString += `${key}: ${value}\n`;
      });
    } catch (e) {
      console.warn('GMAIL RESOLVER: Invalid headers format, ignoring');
    }
  }

  const email = `From: ${from}\nTo: ${to}\n${headerString}Subject: ${subject}\n\n${body}`;
  const base64EncodedEmail = Buffer.from(email).toString('base64');

  try {
    const result = await makePostRequest('/gmail/v1/users/me/messages/send', {
      raw: base64EncodedEmail,
    });
    return asInstance(
      {
        id: result.id,
        thread_id: result.threadId,
      },
      'EmailSentOutput'
    );
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to send email: ${error}`);
    return { result: 'error', message: error.message };
  }
};

// Query email sent
export const queryEmailSent = async (env, attrs) => {
  const id = attrs.queryAttributeValues?.get('__path__')?.split('/')?.pop() ?? null;

  if (!id) {
    return { result: 'error', message: 'Email ID is required' };
  }

  try {
    const result = await makeGetRequest(`/gmail/v1/users/me/messages/${id}`);
    return [
      asInstance(
        {
          id: result.id,
          thread_id: result.threadId,
        },
        'EmailSentOutput'
      ),
    ];
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to query email sent: ${error}`);
    return { result: 'error', message: error.message };
  }
};

// Fetch attachment
export const fetchAttachment = async (env, attributes) => {
  const threadId = attributes.attributes.get('thread_id');
  const attachmentId = attributes.attributes.get('attachment_id');

  if (!threadId || !attachmentId) {
    return {
      result: 'error',
      message: 'Thread ID and Attachment ID are required',
    };
  }

  try {
    // First get the message to find the correct message ID
    const messages = await makeGetRequest(`/gmail/v1/users/me/threads/${threadId}`);
    const messageId = messages.messages?.[0]?.id;

    if (!messageId) {
      return { result: 'error', message: 'No messages found in thread' };
    }

    const result = await makeGetRequest(
      `/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`
    );
    return result.data; // Return base64 encoded attachment data
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to fetch attachment: ${error}`);
    return { result: 'error', message: error.message };
  }
};

// Subscription functions for real-time updates
async function getAndProcessRecords(resolver, entityType) {
  try {
    const tenantId = getLocalEnv('GMAIL_TENANT_ID');
    const userId = getLocalEnv('GMAIL_USER_ID');

    if (!tenantId || !userId) {
      console.error(
        'GMAIL RESOLVER: GMAIL_TENANT_ID and GMAIL_USER_ID are required for subscriptions'
      );
      return;
    }

    let endpoint;
    switch (entityType) {
      case 'emails':
        const pollMinutes = parseInt(getLocalEnv('GMAIL_POLL_MINUTES')) || 10;
        const pollSeconds = pollMinutes * 60;
        const afterTimestamp = Math.floor((Date.now() - pollSeconds * 1000) / 1000);

        const searchQuery = `after:${afterTimestamp}`;
        endpoint = `/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(searchQuery)}`;
        break;
      case 'labels':
        endpoint = '/gmail/v1/users/me/labels';
        break;
      default:
        console.error(`GMAIL RESOLVER: Unknown entity type: ${entityType}`);
        return;
    }

    const result = await makeGetRequest(endpoint);

    if (entityType === 'emails' && result.messages) {
      for (let i = 0; i < result.messages.length; ++i) {
        const message = result.messages[i];

        // Get full message details
        const messageDetail = await makeGetRequest(`/gmail/v1/users/me/messages/${message.id}`);
        const headers =
          messageDetail.payload?.headers?.reduce((acc, current) => {
            return {
              ...acc,
              [current.name]: current.value,
            };
          }, {}) || {};
        const mappedData = toEmail(messageDetail, headers);
        const entityInstance = asInstance(mappedData, 'Email');
        const envelope = createSubscriptionEnvelope(tenantId, userId, entityInstance);
        await resolver.onSubscription(envelope, true);
      }
    } else if (entityType === 'labels' && result.labels) {
      for (let i = 0; i < result.labels.length; ++i) {
        const label = result.labels[i];

        const mappedData = toLabel(label);
        const entityInstance = asInstance(mappedData, 'Label');
        const envelope = createSubscriptionEnvelope(tenantId, userId, entityInstance);
        await resolver.onSubscription(envelope, true);
      }
    }
  } catch (error) {
    console.error(`GMAIL RESOLVER: Failed to process ${entityType} records: ${error}`);
  }
}

async function handleSubsEmails(resolver) {
  await getAndProcessRecords(resolver, 'emails');
}

async function handleSubsLabels(resolver) {
  await getAndProcessRecords(resolver, 'labels');
}

export async function subsEmails(resolver) {
  await handleSubsEmails(resolver);
  const intervalMinutes = parseInt(getLocalEnv('GMAIL_POLL_INTERVAL_MINUTES')) || 15;
  const intervalMs = intervalMinutes * 60 * 1000;

  setInterval(async () => {
    await handleSubsEmails(resolver);
  }, intervalMs);
}

export async function subsLabels(resolver) {
  await handleSubsLabels(resolver);
  const intervalMinutes = parseInt(getLocalEnv('GMAIL_POLL_INTERVAL_MINUTES')) || 15;
  const intervalMs = intervalMinutes * 60 * 1000;

  setInterval(async () => {
    await handleSubsLabels(resolver);
  }, intervalMs);
}
