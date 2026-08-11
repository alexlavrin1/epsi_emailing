const Stripe = require('stripe');
const config = require('../../config');

let client;

function getStripeClient() {
  if (!config.stripe.restrictedKey) {
    throw new Error('STRIPE_RESTRICTED_KEY is not configured');
  }
  if (!client) {
    client = new Stripe(config.stripe.restrictedKey, {
      apiVersion: config.stripe.apiVersion,
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }
  return client;
}

module.exports = { getStripeClient };
