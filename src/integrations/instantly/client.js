const API_BASE = 'https://api.instantly.ai/api/v2';
const PAGE_SIZE = 100;
const MAX_RETRIES = 4;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(path, options = {}, attempt = 0) {
  const apiKey = process.env.INSTANTLY_API_KEY;
  if (!apiKey) throw new Error('INSTANTLY_API_KEY is not configured');

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (response.ok) return data;

  if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter)
      ? retryAfter * 1000
      : Math.min(1000 * (2 ** attempt) + Math.floor(Math.random() * 250), 10000);
    await sleep(delay);
    return request(path, options, attempt + 1);
  }

  const message = typeof data === 'object' ? data?.message : String(data || 'Unknown error');
  throw new Error(`Instantly API ${response.status}: ${message}`);
}

async function getLeadList(listId = process.env.INSTANTLY_LIST_ID) {
  if (!listId) throw new Error('INSTANTLY_LIST_ID is not configured');
  return request(`/lead-lists/${encodeURIComponent(listId)}`);
}

async function listAllLeads(listId = process.env.INSTANTLY_LIST_ID) {
  if (!listId) throw new Error('INSTANTLY_LIST_ID is not configured');

  const leads = [];
  let cursor = null;

  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    const body = {
      list_id: listId,
      limit: PAGE_SIZE,
      distinct_contacts: true,
    };
    if (cursor) body.starting_after = cursor;

    const page = await request('/leads/list', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const items = page?.items || [];
    leads.push(...items);

    if (items.length < PAGE_SIZE) break;
    const nextCursor = String(items[items.length - 1]?.email || '').trim().toLowerCase();
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  return leads;
}

module.exports = { getLeadList, listAllLeads, request };
