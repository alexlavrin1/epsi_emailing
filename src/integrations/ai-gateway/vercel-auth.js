function getVercelOidcToken(headers = {}) {
  const value = headers['x-vercel-oidc-token'];
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  return token && token.length <= 16384 ? token : undefined;
}

module.exports = { getVercelOidcToken };
