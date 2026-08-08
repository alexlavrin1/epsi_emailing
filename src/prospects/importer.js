require('../env');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const config = require('../config');
const logger = require('../utils/logger');

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Edit these filters to match the EPSI Fund target audience.
// No other files need to change.
const IMPORT_CONFIG = {
  apollo: {
    organizationLocations: ['India'],
    // Ranges: 'min,max' — adjust to match Apollo's buckets
    organizationNumEmployeesRanges: ['1,10', '11,20', '21,50', '51,100', '101,200'],
    // Keyword tags on the organization in Apollo
    organizationKeywordTags: ['shopify development'],
    contactEmailStatus: ['verified'],
    maxResults: 100,
    perPage: 25,
    delayBetweenPagesMs: 1200,
    enrichBatchSize: 10,
    delayBetweenEnrichMs: 500,
  },
  kvk: {
    // KVK is a Dutch business registry — not used for India. Leave KVK_API_KEY blank.
    requireActive: true,
    allowedSbiCodes: [],
    minEmployees: 1,
    maxEmployees: 1000,
    delayBetweenLookupsMs: 400,
  },
};

const supabase = createClient(config.supabase.url, config.supabase.key);

// ─── APOLLO SEARCH ───────────────────────────────────────────────────────────
async function fetchApolloPage(page, apolloConfig) {
  const res = await axios.post(
    'https://api.apollo.io/api/v1/mixed_people/api_search',
    {
      page,
      per_page: apolloConfig.perPage,
      organization_locations: apolloConfig.organizationLocations,
      ...(apolloConfig.organizationNumEmployeesRanges.length && {
        organization_num_employees_ranges: apolloConfig.organizationNumEmployeesRanges,
      }),
      ...(apolloConfig.organizationKeywordTags?.length && {
        q_organization_keyword_tags: apolloConfig.organizationKeywordTags,
      }),
      ...(apolloConfig.contactEmailStatus?.length && {
        contact_email_status: apolloConfig.contactEmailStatus,
      }),
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
      timeout: 15000,
    }
  );
  return res.data;
}

// ─── APOLLO ENRICH ───────────────────────────────────────────────────────────
async function enrichBatch(people) {
  const res = await axios.post(
    'https://api.apollo.io/api/v1/people/bulk_match',
    {
      details: people.map(p => ({
        id: p.id,
        ...(p.firstName   && { first_name:        p.firstName }),
        ...(p.lastName    && { last_name:          p.lastName }),
        ...(p.companyName && { organization_name:  p.companyName }),
      })),
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.APOLLO_API_KEY,
      },
      timeout: 15000,
    }
  );
  return res.data?.matches || [];
}

// ─── KVK (optional — validates Dutch companies) ───────────────────────────────
async function lookupKvk(companyName) {
  let searchResults;
  try {
    const searchRes = await axios.get('https://api.kvk.nl/api/v2/zoeken', {
      params: { q: companyName, resultatenPerPagina: 5 },
      headers: { apikey: process.env.KVK_API_KEY },
      timeout: 10000,
    });
    searchResults = searchRes.data?.resultaten || [];
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }

  if (!searchResults.length) return null;
  const kvkNummer = searchResults[0].kvkNummer;
  if (!kvkNummer) return null;

  try {
    const profileRes = await axios.get(
      `https://api.kvk.nl/api/v2/basisprofielen/${kvkNummer}`,
      { headers: { apikey: process.env.KVK_API_KEY }, timeout: 10000 }
    );
    const p = profileRes.data;
    return {
      kvkNummer,
      naam: p.naam,
      isActief: p.indActief === 'Ja' || (!p.datumOpheffing && p.indActief !== 'Nee'),
      sbiCodes: (p.sbiActiviteiten || []).map(a => String(a.sbiCode)),
      employees: p.totaalWerkzamePersonen ?? null,
    };
  } catch {
    return { kvkNummer, naam: searchResults[0].naam, isActief: true, sbiCodes: [], employees: null };
  }
}

function passesKvkFilter(kvkData, kvkConfig) {
  if (!kvkData) return false;
  if (kvkConfig.requireActive && !kvkData.isActief) return false;
  if (kvkConfig.allowedSbiCodes.length > 0) {
    const hasMatch = kvkData.sbiCodes.some(code =>
      kvkConfig.allowedSbiCodes.some(allowed => code.startsWith(allowed))
    );
    if (!hasMatch) return false;
  }
  if (kvkData.employees !== null) {
    if (kvkData.employees < kvkConfig.minEmployees) return false;
    if (kvkData.employees > kvkConfig.maxEmployees) return false;
  }
  return true;
}

// ─── DATABASE ─────────────────────────────────────────────────────────────────
async function upsertProspect(prospect) {
  const { error } = await supabase
    .from('prospects')
    .upsert(prospect, { onConflict: 'email', ignoreDuplicates: false });
  if (error) throw error;
}

async function getProspectIdsByEmails(emails) {
  if (!emails.length) return [];
  const { data, error } = await supabase
    .from('prospects')
    .select('id')
    .in('email', emails);
  if (error) throw error;
  return (data || []).map(r => r.id);
}

async function getSkippedApolloIds(apolloIds) {
  if (!apolloIds.length) return new Set();
  const { data } = await supabase
    .from('skipped_apollo_ids')
    .select('apollo_id')
    .in('apollo_id', apolloIds);
  return new Set((data || []).map(r => r.apollo_id));
}

async function markApolloIdsSkipped(apolloIds, reason = 'no_email') {
  if (!apolloIds.length) return;
  const rows = apolloIds.map(id => ({ apollo_id: id, reason }));
  const { error } = await supabase
    .from('skipped_apollo_ids')
    .upsert(rows, { onConflict: 'apollo_id', ignoreDuplicates: true });
  if (error) logger.warn('[importer] Failed to record skipped IDs', error.message);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chunks(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size));
  return result;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function runImportCycle({ dryRun = false, filters = {} } = {}) {
  if (!process.env.APOLLO_API_KEY) throw new Error('Missing APOLLO_API_KEY');

  const apolloConfig = { ...IMPORT_CONFIG.apollo, ...(filters.apollo || {}) };
  const kvkConfig    = { ...IMPORT_CONFIG.kvk,    ...(filters.kvk    || {}) };

  const kvkEnabled = !!(
    process.env.KVK_API_KEY &&
    process.env.KVK_API_KEY !== 'your_kvk_api_key_here'
  );

  if (!kvkEnabled) {
    logger.warn('[importer] KVK_API_KEY not set — importing all Apollo contacts without validation');
  }

  logger.info(`[importer] Starting import — dry-run=${dryRun} kvk=${kvkEnabled}`);
  const stats = { apolloTotal: 0, noEmail: 0, kvkFail: 0, kvkSkip: 0, alreadyKnown: 0, enriched: 0, imported: 0 };
  const importedEmails = [];
  const toEnrich = [];
  let page = 1;

  // Phase 1: search + KvK validate → collect Apollo IDs to enrich
  while (true) {
    logger.info(`[importer] Apollo search page ${page}...`);
    let data;
    try {
      data = await fetchApolloPage(page, apolloConfig);
    } catch (err) {
      logger.error(`[importer] Apollo error on page ${page}`, err.response?.data?.message || err.message);
      break;
    }

    const people = data.people || [];
    if (!people.length) {
      logger.info('[importer] No more Apollo results — pool exhausted');
      break;
    }

    stats.apolloTotal += people.length;
    logger.info(`[importer] Got ${people.length} contacts (total so far: ${stats.apolloTotal})`);

    for (const person of people) {
      if (!person.has_email) { stats.noEmail++; continue; }

      const companyName = person.organization?.name;

      if (kvkEnabled && companyName) {
        let kvkData = null;
        try {
          kvkData = await lookupKvk(companyName);
          await sleep(kvkConfig.delayBetweenLookupsMs);
        } catch (err) {
          logger.warn(`[importer] KvK lookup error for "${companyName}": ${err.message}`);
          stats.kvkFail++;
          continue;
        }
        if (!passesKvkFilter(kvkData, kvkConfig)) {
          stats.kvkSkip++;
          continue;
        }
      }

      toEnrich.push({ id: person.id, companyName, firstName: person.first_name, lastName: person.last_name });
    }

    if (stats.apolloTotal >= apolloConfig.maxResults || !people.length) break;
    page++;
    await sleep(apolloConfig.delayBetweenPagesMs);
  }

  logger.info(`[importer] Search done — ${toEnrich.length} prospects passed filters`);

  // Dedup against DB
  let newToEnrich = toEnrich;
  if (toEnrich.length > 0) {
    const apolloIds = toEnrich.map(p => p.id);
    const { data: existing } = await supabase.from('prospects').select('apollo_id').in('apollo_id', apolloIds);
    const knownIds    = new Set((existing || []).map(r => r.apollo_id));
    const skippedIds  = await getSkippedApolloIds(apolloIds);
    newToEnrich = toEnrich.filter(p => !knownIds.has(p.id) && !skippedIds.has(p.id));
    stats.alreadyKnown = toEnrich.length - newToEnrich.length;
    logger.info(`[importer] ${stats.alreadyKnown} already known — enriching ${newToEnrich.length} new`);
  }

  if (dryRun) {
    logger.info(`[importer] dry-run: would enrich and import ${newToEnrich.length} new prospect(s)`);
    stats.imported = newToEnrich.length;
    return { stats, importedIds: [] };
  }

  // Phase 2: enrich in batches of 10 to get actual emails
  for (const batch of chunks(newToEnrich, IMPORT_CONFIG.apollo.enrichBatchSize)) {
    let matches;
    try {
      matches = await enrichBatch(batch);
      stats.enriched += matches.length;
    } catch (err) {
      logger.error('[importer] bulk_match error', err.response?.data?.message || err.message);
      await sleep(IMPORT_CONFIG.apollo.delayBetweenEnrichMs);
      continue;
    }

    const matchedIds  = new Set(matches.filter(m => m.email).map(m => m.id));
    const noEmailIds  = batch.map(p => p.id).filter(id => !matchedIds.has(id));
    await markApolloIdsSkipped(noEmailIds, 'no_email');

    for (const match of matches) {
      if (!match.email) continue;
      const prospect = {
        apollo_id:    match.id            || null,
        email:        match.email,
        first_name:   match.first_name    || null,
        last_name:    match.last_name     || null,
        company:      match.organization?.name || null,
        title:        match.title         || null,
        linkedin_url: match.linkedin_url  || null,
        website_url:  match.organization?.website_url || match.organization?.primary_domain || null,
      };
      try {
        await upsertProspect(prospect);
        importedEmails.push(match.email);
        logger.debug(`[importer] ✓ ${match.email}`);
        stats.imported++;
      } catch (err) {
        logger.error(`[importer] ✗ ${match.email}`, err.message);
      }
    }
    await sleep(IMPORT_CONFIG.apollo.delayBetweenEnrichMs);
  }

  logger.info(
    `[importer] Done — searched=${stats.apolloTotal} noEmail=${stats.noEmail} ` +
    `kvkSkip=${stats.kvkSkip} kvkFail=${stats.kvkFail} ` +
    `alreadyKnown=${stats.alreadyKnown} enriched=${stats.enriched} imported=${stats.imported}`
  );

  const importedIds = await getProspectIdsByEmails(importedEmails);
  return { stats, importedIds };
}

module.exports = { runImportCycle, IMPORT_CONFIG };
