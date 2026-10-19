// Server-side only. Reusable by notifications and future quote delivery.
export function createGraphMailer(env = process.env, request = fetch) {
  const enabled = env.SALES_MAIL_ENABLED === 'true';
  let token = null;
  let expires = 0;
  const fail = code => Object.assign(new Error(code), { code });
  async function call(url, options) {
    try { return await request(url, { ...options, signal: AbortSignal.timeout(20000) }); }
    catch { throw fail('mail_network_error'); }
  }
  return {
    enabled,
    async send({ from, to, subject, text }) {
      if (!enabled) return { disabled: true };
      const { SALES_MAIL_TENANT_ID: tenant, SALES_MAIL_CLIENT_ID: client, SALES_MAIL_CLIENT_SECRET: secret } = env;
      if (!tenant || !client || !secret || !from) throw fail('mail_config_missing');
      if (!/^[\w.-]+@[\w.-]+$/.test(from) || !Array.isArray(to) || !to.length || to.some(address => !/^[\w.+-]+@[\w.-]+$/.test(address))) throw fail('mail_address_invalid');
      if (!token || Date.now() >= expires) {
        const response = await call(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: client, client_secret: secret, grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
        });
        if (!response.ok) throw fail(`mail_auth_http_${response.status}`);
        const result = await response.json();
        if (!result.access_token) throw fail('mail_token_missing');
        token = result.access_token;
        expires = Date.now() + Math.max(0, Number(result.expires_in || 3600) - 60) * 1000;
      }
      const response = await call(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { subject: String(subject).replace(/[\r\n]/g, ' ').slice(0, 255), body: { contentType: 'Text', content: text }, toRecipients: to.map(address => ({ emailAddress: { address } })) }, saveToSentItems: true }),
      });
      if (!response.ok) {
        if (response.status === 401) { token = null; expires = 0; }
        throw fail(`mail_send_http_${response.status}`);
      }
      return { accepted: true }; // Graph 202 = accepted for processing, not delivery receipt.
    },
  };
}
