# EpsiFlow acquisition email campaign — v1

Status: Draft for review; not approved for live sending.

## Campaign goal

Start qualified conversations with Indian Shopify app businesses that are running, planning, or actively evaluating Shopify Ads and may be blocked by unreliable payment methods.

The conversion target is not merely a reply or account registration. The commercial path is:

Qualified reply → onboarding conversation → EpsiFund account → payment setup → funded account → first successful advertising transaction.

## Audience and qualification

### Primary contacts

- Founder, co-founder, or CEO at a founder-led Shopify app business.
- Growth or marketing lead who owns app acquisition or Shopify Ads.
- An operator who directly owns advertising payments.

### Company requirements

- Operates at least one Shopify app.
- Based in India or demonstrably affected by Indian cross-border card constraints.
- Has enough traction or intent to consider paid acquisition.
- Shows a recent growth, launch, advertising, hiring, or app-development signal.

### Priority tiers

1. **Tier A — demonstrated need:** mentions Shopify Ads, payment failures, international card issues, or interrupted campaigns.
2. **Tier B — active growth signal:** recently launched or updated an app, is hiring for growth, is expanding its app portfolio, or is visibly investing in merchant acquisition.
3. **Tier C — firmographic fit only:** Shopify app company in India, but no relevant trigger found. Use the segment-level fallback email and test separately from Tier A/B.

Do not contact generic software companies merely because they are located in India. The Shopify app and paid-acquisition connection is what makes the message relevant.

## Personalization data

The preferred opener is one factual observation that connects directly to acquisition or payment infrastructure:

- `{{triggerObservation}}` — a complete phrase such as “you recently launched a second Shopify app” or “your team is hiring for app growth.”
- `{{triggerSource}}` — internal provenance for review; it should not appear in the email.
- `{{triggerDate}}` — when the signal was observed, so stale signals can be rejected.

Every observation must pass three checks:

1. It is factually supported by a recorded source.
2. It is recent enough to remain relevant.
3. It leads naturally to the Shopify Ads/payment question.

The current sender only supports `{{firstName}}`, `{{lastName}}`, `{{company}}`, `{{companyName}}`, `{{senderName}}`, and `{{signature}}`. Trigger-based personalization therefore requires either manual insertion or a later schema/template change before automation.

## Subject lines

Test these as separate campaign variants rather than choosing based on opens alone:

1. `shopify ads`
2. `ad payments`
3. `payment setup`

Keep them lowercase and unadorned. Do not use the recipient's name, emojis, urgency, or a fake `Re:` prefix. Real follow-ups may remain in the original email thread.

## Sequence

Recommended cadence: day 0, day 3, day 8, and day 14. Send Tuesday–Thursday where possible, around 9–11 a.m. or 1–3 p.m. in the prospect's local time.

### Email 1 — trigger and problem

Purpose: determine whether the payment constraint is relevant without forcing a meeting request.

Subject: one of the tested subject lines above

```text
Hi {{firstName}},

Saw that {{triggerObservation}}. Are payment issues ever getting in the way of Shopify Ads at {{companyName}}?

EpsiFlow provides Indian Shopify app teams with a dedicated account and digital debit card for eligible ad spend, so local card limitations don't have to block campaigns.

Worth sending over how the setup works?

{{signature}}
```

Tier C fallback when no honest trigger is available:

```text
Hi {{firstName}},

Quick question: do Indian card or cross-border payment restrictions ever get in the way of running Shopify Ads at {{companyName}}?

EpsiFlow provides the account and digital card infrastructure for eligible ad spend.

Would a short overview be useful?

{{signature}}
```

### Email 2 — campaign reliability

Timing: 3 days after Email 1.

Purpose: introduce the operational cost of a payment failure rather than repeat the first email.

```text
Hi {{firstName}},

When a Shopify Ads payment fails, the cost isn't only the admin work. Campaigns can pause while the team finds another card or banking route.

The EpsiFlow setup includes a dedicated balance, transaction visibility, and invoices in one account.

Would it help if I sent the setup outline?

{{signature}}
```

### Email 3 — low-friction onboarding

Timing: 5 days after Email 2; day 8 overall.

Purpose: reduce perceived implementation effort.

```text
Hi {{firstName}},

The setup is fairly light: create an EpsiFund account, EpsiFlow provisions the bank account and digital card, then the details are handed over on a short call.

If Shopify Ads are on {{companyName}}'s roadmap, want me to send the onboarding steps?

{{signature}}
```

### Email 4 — close the loop

Timing: 6 days after Email 3; day 14 overall.

Purpose: end outreach clearly and make the last response effortless.

```text
Hi {{firstName}},

I'll close the loop after this.

If Shopify Ads payments aren't a constraint for {{companyName}}, there's nothing to do. If they are, reply “setup” and I'll send the steps.

{{signature}}
```

After Email 4, stop the sequence. Do not recycle the contact into another campaign unless there is a genuinely new, relevant trigger and the contact has not opted out.

## Reply handling

### Positive or curious reply

```text
Thanks, {{firstName}}. The short version is:

1. You create an EpsiFund account.
2. EpsiFlow provisions the bank account and digital debit card.
3. We hand over the card details on a short call.
4. You fund the account and can track eligible spend and invoices there.

Are you already running Shopify Ads, or planning to start?
```

The question qualifies timing without immediately asking for a sales call.

### Confirmed payment problem

```text
That sounds like the situation EpsiFlow is designed for. To make sure the setup fits: are payments failing on an existing Shopify Ads account, or is the card issue preventing the first campaign from launching?
```

Once the situation is understood, offer the smallest appropriate next step: written instructions, an eligibility check, or a short onboarding call.

### Not now

Ask whether they want a specific follow-up month. Record that date and do not continue the current sequence.

### Not interested or unsubscribe

Acknowledge once, mark the contact as unsubscribed, suppress all scheduled messages, and do not contact them again.

## Qualification questions

Use only the questions needed for the conversation; do not send a questionnaire.

- Are you currently running Shopify Ads, or planning to start?
- What payment method are you using or trying to use?
- Is the issue a rejected payment, unreliable recurring billing, or access to a suitable card?
- When do you want the campaign live?
- Who owns the advertising account and payment decision?
- What does successful onboarding mean: first campaign launch, restored campaigns, or more reliable ongoing spend?

## Objection guide

| Prospect response | Recommended response | Evidence or next step |
|---|---|---|
| “Our current card works.” | “Good — there may be nothing to change. Is it reliable for ongoing Shopify Ads billing, or have there been occasional failures?” | Qualify reliability; do not manufacture a problem. |
| “We're not running Shopify Ads.” | “Understood. Is paid placement something you're considering this year, or not part of the plan?” | Close the conversation if there is no near-term intent. |
| “How is this different from a forex card?” | “The key difference is the managed setup around the payment method: account provisioning, a dedicated card, spend visibility, invoices, and support. Fit still depends on your exact use case.” | Offer a use-case review; avoid unsupported comparisons. |
| “Is this compliant/secure?” | “That's the right question. I don't want to give you an incomplete answer over email. I can send the applicable documentation and arrange for the team to address your requirements directly.” | Only provide verified legal, compliance, security, and custody documentation. Never improvise assurances. |
| “What does it cost?” | Answer with the approved pricing and fee structure plainly. | Pricing is not present in the product overview and must be supplied before launch. |
| “Not now.” | “No problem. Is there a month when Shopify Ads becomes more relevant, or should I close this out?” | Record an explicit follow-up date or suppress the contact. |

## Claims and proof rules

- Do not invent customer counts, savings, approval rates, transaction success rates, or revenue outcomes.
- Do not imply guaranteed card acceptance or uninterrupted campaigns.
- Do not describe EpsiFlow as a bank or make legal, regulatory, security, or eligibility claims without approved documentation.
- “Used by other Shopify businesses” should only be included after a verifiable proof point is approved.
- Replace general claims with specific customer evidence when EpsiFlow has permission to use it.

Before launch, the campaign would be stronger with one approved proof asset: an anonymized customer example, a quantified onboarding result, or a documented before/after payment story.

## Measurement plan

Track results by subject variant, priority tier, contact persona, trigger type, and source list.

Primary metrics:

- Delivered emails and bounce rate.
- Total and unique reply rate.
- Positive reply rate.
- Qualified-conversation rate.
- Prospects agreeing to proceed.
- EpsiFund accounts created.
- Accounts funded.
- First successful advertising transactions.
- Time from first email to first transaction.
- Unsubscribe and complaint rate.

Open rate is diagnostic only and should not decide the winning variant. The winning campaign is the one that produces qualified conversations and activated clients without harming deliverability.

## Test design

- Start with small, separate cohorts of no more than 50 contacts per variant.
- Change one major variable at a time: subject, opener, segment, or CTA.
- Keep Tier A/B results separate from Tier C so weak targeting is not hidden by aggregate numbers.
- Review replies qualitatively to identify misunderstood claims, new objections, and better ICP signals.
- Promote a variant only after it has enough delivered emails to avoid reacting to a handful of responses.

## Launch blockers

Do not activate this campaign in the current sender until:

1. Automated reply detection is working, so positive and negative replies stop follow-ups.
2. Unsubscribe handling and a permanent suppression mechanism exist.
3. Contact provenance, lawful outreach basis, and jurisdiction-specific requirements have been reviewed.
4. Sender identity, domain authentication, and bounce handling have been verified.
5. Pricing, eligibility, security, compliance, and support answers are approved for sales use.
6. The `{{triggerObservation}}` data path is implemented or the segment-level fallback is deliberately selected.

## Next iteration inputs

Use campaign replies and onboarding outcomes to update the future `acquisition_rulebook.md` with:

- Proven ICP and disqualification rules.
- Trigger definitions and freshness windows.
- Approved claims and proof library.
- Reply classifications and routing rules.
- Objection responses.
- Experiment history and winning variants.
- Activation-stage handoffs and ownership.
