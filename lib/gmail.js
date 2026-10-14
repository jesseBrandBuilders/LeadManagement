export async function accessToken(c, fetcher = fetch) {
  const clientId = String(c.client || '').trim();
  const clientSecret = String(c.clientSecret || '').trim();
  const refreshToken = String(c.refresh || '').trim();

  const missing = [];

  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!refreshToken) missing.push('GOOGLE_REFRESH_TOKEN');

  if (missing.length) {
    throw new Error(
      'Missing in deployment ' +
      (process.env.VERCEL_ENV || 'unknown') +
      ': ' +
      missing.join(', ')
    );
  }

  const response = await fetcher(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      signal: AbortSignal.timeout(10000),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      'Google token refresh returned an unreadable response'
    );
  }

  if (
    !response.ok ||
    typeof data?.access_token !== 'string' ||
    !data.access_token.trim()
  ) {
    const knownErrors = [
      'invalid_grant',
      'invalid_client',
      'unauthorized_client',
      'invalid_scope'
    ];

    const reason = knownErrors.includes(data?.error)
      ? data.error
      : 'HTTP ' + response.status;

    throw new Error('Google token refresh failed: ' + reason);
  }

  return data.access_token.trim();
}

export async function sendGmail(raw, token, fetcher = fetch) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error(
      'No Google access token was returned. Nothing was sent.'
    );
  }

  if (
    typeof raw !== 'string' ||
    !raw ||
    !/^[A-Za-z0-9_-]+$/.test(raw)
  ) {
    throw new Error(
      'The email payload is missing or is not base64url encoded. Nothing was sent.'
    );
  }

  let response;

  try {
    response = await fetcher(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        signal: AbortSignal.timeout(12000),
        headers: {
          Authorization: 'Bearer ' + token.trim(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw })
      }
    );
  } catch {
    throw Object.assign(
      new Error(
        'Gmail response was interrupted. Inspect Sent Mail before retrying.'
      ),
      { uncertain: true }
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw Object.assign(
      new Error(
        'Gmail returned an unreadable response. Inspect Sent Mail before retrying.'
      ),
      { uncertain: true }
    );
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(
        'Gmail rejected the send (HTTP ' + response.status + ').'
      ),
      { uncertain: response.status >= 500 }
    );
  }

  if (typeof data?.id !== 'string' || !data.id.trim()) {
    throw Object.assign(
      new Error(
        'Gmail did not return a message ID. Inspect Sent Mail before retrying.'
      ),
      { uncertain: true }
    );
  }

  return data.id.trim();
}
