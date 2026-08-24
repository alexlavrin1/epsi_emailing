BEGIN;

-- Preserve every prior draft's version while moving the active lead playbook to
-- a new version containing the operator-confirmed commercial terms.
DO $upgrade$
DECLARE
  target RECORD;
  next_version INTEGER;
  pricing_prompt TEXT := $prompt$Use the complete synchronized email history and CRM context. Treat the latest unanswered inbound message as the primary task. If the lead asks questions or requests details, answer every request directly before offering a next step; never merely promise to explain later.

Confirmed EpsiFlow facts: EpsiFlow helps Shopify app companies launch and run Shopify Ads when payment setup is the blocker. The onboarding path is: confirm fit and intended ad spend; create an account at https://app.epsifund.com/; EpsiFlow provisions the relevant account and digital debit card; complete a short controlled card-detail handover; add the payment method to Shopify Ads; fund it through the agreed route; then monitor spend and invoices in the app.

There are two commercial routes. Stripe auto-renew plans top up the Ads budget monthly: pay $160 for $100 budget; $630 for $500; $1,160 for $1,000; $1,695 for $1,500; $2,200 for $2,000; $2,720 for $2,500; $3,245 for $3,000; or $3,770 for $3,500. EpsiFlow Direct costs $66 per month regardless of top-up activity, plus approximately $91 per direct transfer. Always qualify the $91 amount as approximate.

When pricing is requested, clearly explain both routes and the relevant budget/payment pairs. Connect the options to the lead's expected monthly Ads budget, then ask one low-friction question about budget or preferred route. Do not invent taxes, FX costs, refund terms, custody details, discounts, or other unlisted terms; surface those for human review.$prompt$;
BEGIN
  FOR target IN
    SELECT playbook.*
    FROM client_playbooks playbook
    WHERE playbook.preset_key='lead_education_manual'
  LOOP
    next_version := target.current_version+1;

    INSERT INTO client_playbook_versions(
      playbook_id,
      version,
      subject_template,
      body_template,
      agent_prompt,
      definition,
      created_by_user_id
    ) VALUES (
      target.id,
      next_version,
      'EpsiFlow setup and pricing for {{clientName}}',
      E'Hi {{contactFirstName}},\n\nEpsiFlow helps Shopify app companies get Shopify Ads running when payment setup is the blocker. Onboarding starts by confirming fit and expected spend, creating an account at https://app.epsifund.com/, and completing a short handover so the provisioned digital card can be added to Shopify Ads.\n\nThere are two funding routes. Stripe plans renew monthly: $160 pays for a $100 Ads budget; $630 for $500; $1,160 for $1,000; $1,695 for $1,500; $2,200 for $2,000; $2,720 for $2,500; $3,245 for $3,000; or $3,770 for $3,500. EpsiFlow Direct is $66 per month regardless of top-up activity, plus approximately $91 per direct transfer.\n\nWhat monthly Ads budget are you planning, and would you prefer automatic Stripe top-ups or direct transfers?\n\nBest,\nEpsiFlow',
      pricing_prompt,
      jsonb_build_object(
        'trigger','assigned_client_monitor',
        'signals',ARRAY['unanswered_inbound','followup_due','periodic_due'],
        'channel','email',
        'eligible_client_segments',ARRAY['lead'],
        'approval','required',
        'pricing_source','operator_confirmed_2026-08-24',
        'pricing_url','https://app.epsifund.com/version-live/epsiflow'
      ),
      target.updated_by_user_id
    );

    UPDATE client_playbooks
    SET current_version=next_version,
        updated_at=NOW()
    WHERE id=target.id;
  END LOOP;
END
$upgrade$;

COMMIT;
