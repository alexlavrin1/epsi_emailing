require('../src/env');
const config = require('../src/config');
const db = require('../src/db/supabase');
const { lookupUserByEmail } = require('../src/integrations/slack/client');

function parseArgs(argv) {
  const value = flag => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : null;
  };
  return {
    stripeCustomerId: value('--stripe-customer'),
    slackEmail: value('--slack-email'),
    confirm: argv.includes('--confirm'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.stripeCustomerId || !args.slackEmail) {
    throw new Error('Usage: --stripe-customer cus_... --slack-email person@example.com [--confirm]');
  }
  if (!config.supabase.isServerKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');

  const customer = await db.getCrmCustomerByStripeId(args.stripeCustomerId);
  if (!customer) throw new Error('CRM customer not found; process its Stripe event first');
  const slackIdentity = await lookupUserByEmail(args.slackEmail);

  const preview = {
    stripeCustomerId: customer.stripe_customer_id,
    crmEmailMatchesSlackLookup:
      String(customer.email || '').toLowerCase() === String(args.slackEmail).toLowerCase(),
    slackTeamId: slackIdentity.teamId,
    slackUserId: slackIdentity.userId,
    slackDisplayName: slackIdentity.displayName,
    confirmed: args.confirm,
  };

  if (!args.confirm) {
    console.log(JSON.stringify(preview, null, 2));
    console.log('No database change made. Re-run with --confirm after reviewing the IDs.');
    return;
  }

  const updated = await db.setCrmCustomerSlackIdentity(
    customer.id,
    slackIdentity.teamId,
    slackIdentity.userId
  );
  console.log(JSON.stringify({
    ...preview,
    mapped: updated.slack_enabled === true,
  }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[fatal] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs };
