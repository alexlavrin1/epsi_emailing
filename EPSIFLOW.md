Yes. Since the download layer keeps failing, here is the actual content directly in chat.

# EpsiFlow — Business, Product, Customer, and Go-to-Market Overview

_Last updated: 23 August 2026_

## 1. Executive Summary

EpsiFlow is a payment and operational infrastructure service designed primarily for Shopify app developers and Shopify-focused SaaS companies, especially businesses in India that want to run Shopify Ads but face difficulties using their existing Indian payment methods.

The core EpsiFlow proposition is straightforward:

> **EpsiFlow gives eligible Shopify app businesses access to a payment setup they can use for Shopify Ads, while also giving them a simple account for funding, spend tracking, invoices, and support.**

The service exists because paying Shopify directly is not always operationally simple for Indian developers. Even businesses that are willing and able to spend on Shopify Ads can run into payment-method restrictions, recurring payment issues, card acceptance problems, 3DS authentication failures, foreign-currency friction, or other banking limitations.

EpsiFlow attempts to remove that infrastructure problem so the customer can focus on acquiring merchants rather than figuring out how to make the advertising payment rail work.

At the time reflected in the project notes, EpsiFlow had approximately 12 clients and around $6,000 ARR. These figures came up in the context of a possible acquisition discussion and should be treated as historical figures rather than current operating metrics unless reconfirmed.

## 2. What EpsiFlow Does

EpsiFlow provides a payment infrastructure layer for businesses that need to pay for Shopify Ads.

The current service flow is:

1. A customer decides to proceed with EpsiFlow.
2. The customer creates an account in the EpsiFund application at `https://app.epsifund.com/`.
3. EpsiFlow creates or provisions a bank account for the customer.
4. EpsiFlow generates a digital debit card associated with the customer setup.
5. A short call is scheduled with the customer to transfer or communicate the card details securely.
6. The customer uses the provided payment method for relevant advertising expenses, particularly Shopify Ads.
7. Through the EpsiFund account, the customer can track advertising spend, invoices, and account activity relevant to the service.
8. The customer may also provide a Slack email address so EpsiFlow can add them to the Epsi community. Slack participation is optional rather than a hard onboarding requirement.

The practical outcome is that a Shopify developer who otherwise struggles to pay Shopify for ads can obtain a working advertising payment setup through EpsiFlow.

## 3. The Core Customer Problem

The central EpsiFlow problem is **not necessarily lack of demand for Shopify Ads**.

Many Shopify app developers already understand that Shopify Ads can help them acquire merchants and grow their apps. The blocker can instead be the infrastructure required to pay for those ads reliably.

Typical pains include payment methods being declined, recurring or automatic charges failing, Stripe subscription or card funding flows entering an `incomplete` state because of unfinished 3DS authentication, foreign exchange and international payment restrictions, teams wasting time researching banks, forex cards, Wise, prepaid cards, or other workarounds, and growth campaigns being delayed even though the business is ready to spend.

EpsiFlow therefore targets a highly concrete operational pain:

> **The company wants to advertise, has money to spend, but the payment infrastructure prevents or complicates execution.**

## 4. The Economic Cost of the Problem

An important part of the EpsiFlow positioning is the opportunity cost of not running ads.

The customer is not only dealing with an inconvenient card problem. If Shopify Ads are a viable acquisition channel for the app, every week or month of delay may mean fewer merchant impressions, fewer app-store visits, fewer installs, fewer trials, fewer paid merchants, slower growth, delayed learning about which ads and keywords work, and lost compounding effects from earlier acquisition.

This creates a useful sales framing:

> The payment problem is small operationally, but the growth lost while the problem remains unsolved can be much larger.

This framing should be used carefully. EpsiFlow should not claim a specific amount of lost revenue unless it has customer-specific data to support the calculation.

## 5. Primary Target Audience

The primary EpsiFlow ideal customer profile is a Shopify app developer, a Shopify-focused SaaS company, or a business selling software or services to Shopify merchants, particularly one located in India or operating with Indian banking/payment infrastructure.

The strongest prospects are companies where Shopify Ads are already relevant to their growth strategy but payment limitations are blocking or complicating execution.

Relevant buyer roles include founders, co-founders, CEOs, growth leads, heads of growth, marketing leads, performance marketing leads, COOs, operations leads, and finance leads. For small Shopify app companies, the founder is often the best target because acquisition, finance, and operations decisions tend to be centralized.

India has been the main acquisition focus in the project because EpsiFlow's value proposition is particularly strong where customers are affected by Indian payment or foreign-currency restrictions.

## 6. Who EpsiFlow Is Not Primarily For

EpsiFlow is less compelling for Shopify apps that do not intend to use Shopify Ads, companies whose existing cards already work reliably, businesses whose advertising spend is too small to justify an additional payment-service layer, companies that can solve the same problem more cheaply and reliably through their existing bank, businesses outside the supported banking or compliance setup, and prospects who only want advertising strategy but do not need payment infrastructure.

The existence of an ad-optimization partnership expands EpsiFlow's value proposition, but EpsiFlow itself is primarily payment and operational infrastructure rather than an advertising agency.

## 7. Customer Jobs to Be Done

Customers are effectively hiring EpsiFlow to give them a payment method Shopify Ads will accept, help them start advertising without spending weeks solving banking problems, make ad-related payments more reliable, give them one place to track spend and invoices, reduce operational overhead, and provide support when payments fail.

From a growth perspective, customers want to start Shopify Ads sooner, avoid losing merchant acquisition opportunities because of payment friction, scale spend once campaigns work, and make paid acquisition operationally repeatable.

From an organizational perspective, EpsiFlow also reduces uncertainty around whether the next charge will go through and prevents founders from repeatedly becoming involuntary payment-support technicians, a career path nobody asked for.

## 8. EpsiFlow Value Proposition

The core value proposition can be summarized as:

> **EpsiFlow removes the payment barrier between Shopify app developers and Shopify Ads.**

Supporting value includes a working payment setup designed around the use case, bank account provisioning, a digital debit card, funding/top-up functionality, advertising spend visibility, invoice visibility, guided onboarding, support, optional community access, and access to selected ecosystem partnerships.

The service is particularly useful when the alternative is not merely "use another card," but repeated failed attempts across banks, forex products, subscriptions, authentication flows, and payment restrictions.

## 9. EpsiFlow Onboarding Pipeline

The onboarding begins when a lead indicates that they want to proceed with EpsiFlow. At this stage, the team should ideally confirm that the company is a legitimate Shopify-related business, Shopify Ads are relevant to them, the company has a real payment need, the customer is in a supported jurisdiction, expected monthly ad spend is commercially viable, and the intended use is compliant.

The customer then creates an account at `https://app.epsifund.com/`.

EpsiFlow creates or provisions a bank account for the customer. The precise legal structure of this account, custody arrangement, banking partner, and ownership model should be documented separately if this material is used for compliance, due diligence, or external sales.

EpsiFlow then generates a digital debit card. The card is the key payment instrument used for the customer's supported advertising expenses.

A short call is scheduled with the customer to provide or transfer the relevant card details. This reduces confusion and provides a controlled handover process.

The customer adds the EpsiFlow-provided payment method to the relevant Shopify advertising billing setup and can then begin paying for Shopify Ads through the EpsiFlow infrastructure.

The customer adds funds through either an automatically renewing Stripe plan or EpsiFlow Direct. The confirmed commercial terms are listed below.

Through the EpsiFund application, the customer can monitor ad spending, invoices, and funding/account-related information.

The customer may also share a Slack email address so EpsiFlow can add them to the Epsi community. This is useful but not mandatory.

## 10. Payments and Funding Model

EpsiFlow customers fund their advertising payment setup and then use the issued card for supported transactions. The following terms were confirmed by the operator on 2026-08-24.

Stripe plans automatically renew each month and top up the corresponding Ads budget:

| Ads budget | Customer pays |
| ---: | ---: |
| $100 | $160 |
| $500 | $630 |
| $1,000 | $1,160 |
| $1,500 | $1,695 |
| $2,000 | $2,200 |
| $2,500 | $2,720 |
| $3,000 | $3,245 |
| $3,500 | $3,770 |

EpsiFlow Direct costs $66 per month regardless of top-up activity, plus approximately $91 per direct transfer. Customer-facing messages must describe the transfer amount as approximate.

The Stripe route is positioned as the quickest start with no paperwork and predictable automatic monthly top-ups. The Direct route avoids Stripe as an intermediary, gives the customer more control over when funds are allocated, and may reduce intermediary fees.

A prospect specifically asked for the exact Stripe fee for a $500 top-up, the effective percentage fee by plan, whether unused balances are refundable, refund timelines, refund fees or minimums, and where customer balances are held before they are spent.

These questions reveal what sophisticated prospects care about most: total cost, liquidity, custody/security of funds, exit mechanics, and operational transparency.

The price table and Direct charges above are confirmed. Refund policy, taxes, FX costs, legal custody, and other unlisted terms remain unconfirmed and must not be invented.

## 11. Known Payment Reliability Issue: 3DS / Stripe

One operational issue observed with EpsiFlow is that Stripe can show an `incomplete` status for automatic subscription payments because the customer has not completed 3D Secure authentication.

This can happen even when the initial subscription was completed successfully.

The result is that some later transactions may be rejected, not processed, left incomplete, or delayed until authentication is completed.

This matters because EpsiFlow itself is trying to remove payment friction. Any recurring failure in the EpsiFlow funding layer directly weakens the product promise.

Operational priorities should therefore include understanding when Stripe requires off-session 3DS, improving authentication messaging, using appropriate payment setup flows for future off-session charges, collecting payment methods using flows designed for recurring payments, notifying customers before or immediately after failed payments, avoiding silent funding failures, and providing a clear recovery path.

This problem should be treated as a product and payments-engineering priority.

## 12. Current Acquisition Strategy

The project has focused heavily on outbound acquisition.

The main proposed stack has included Apollo for lead generation and Instantly for cold-email execution and sequencing.

At one point, an Instantly-generated target list contained approximately 428 leads. That size is reasonable for an initial tightly defined campaign if the data quality is strong.

The acquisition strategy emphasizes quality of targeting over maximum list size.

## 13. Lead Generation Filters

Relevant job titles include Founder, Co-founder, CEO, Head of Growth, Growth Lead, Marketing Lead, Performance Marketing, COO, Operations, and Finance.

The main geographic focus is India.

Useful industry categories include software, SaaS, internet, e-commerce software, Shopify applications, information technology, developer tools, marketing technology, customer experience software, and commerce enablement. Broad industry filters should always be combined with Shopify-specific keywords or technology filters.

Useful keywords include Shopify, Shopify app, Shopify App Store, ecommerce app, ecommerce SaaS, Shopify developer, Shopify partner, merchant acquisition, app growth, and ecommerce software.

Shopify-related technology signals can improve precision. For company searches, technology filters are usually more useful than blindly using `shopify.com` as a domain filter.

EpsiFlow likely fits smaller and mid-sized Shopify software businesses particularly well because founders still directly experience operational payment problems. A practical initial employee range can include 1–10, 11–50, and 51–200 employees.

Revenue should be used as a proxy for ability to spend rather than as the primary definition of the ICP.

## 14. Buying Signals

Signals were identified as especially important for EpsiFlow prospecting.

Potential signals include recent product launch, recent LinkedIn activity, recent company posts on Twitter/X, new partnership announcements, discussions of customer acquisition problems, Reddit activity showing relevant pain, Reddit buying intent, advertising or growth hiring, new Shopify app launches, recent fundraising, expansion to a new market, founder discussion about growth, and merchant acquisition initiatives.

For product launches, useful language includes launched, launch, new Shopify app, introducing, now live, App Store launch, new feature, new product, beta, and public launch.

For LinkedIn activity, useful themes include Shopify growth, app growth, acquisition, ads, paid acquisition, Shopify App Store, merchant acquisition, scaling, CAC, conversion, and growth marketing.

For Twitter/X, useful themes include Shopify app, building in public, app launch, Shopify Ads, merchant growth, SaaS growth, acquisition, paid ads, Shopify ecosystem, and app-store ranking.

For partnership signals, useful terms include partnership, integration, strategic partnership, Shopify partner, technology partner, agency partner, ecosystem, and collaboration.

For Reddit pain signals, useful terms include payment declined, card not accepted, Shopify Ads, Shopify billing, international card, Indian card, forex card, recurring payment, 3DS, advertising payments, cannot pay, and payment method.

For Reddit buying intent, useful searches include how to run Shopify Ads, best way to pay Shopify Ads from India, Shopify advertising, how to advertise Shopify app, payment solution, virtual card, international card for SaaS, and card for Shopify Ads.

Signal filtering should identify companies with **both fit and timing**.

## 15. Cold Email Positioning

The cold-email strategy developed in the project follows a problem-awareness approach.

A strong opening idea is:

> You may already know Shopify Ads could help more merchants discover your app, but getting the billing and payment setup to work from India can become the blocker.

The stronger version of the positioning goes one level deeper:

> The real cost is not the card problem itself. It is the acquisition and learning the company delays while Shopify Ads remain inactive.

Cold email should therefore connect existing growth intent, payment friction, opportunity cost, a low-friction EpsiFlow setup, and a simple CTA.

## 16. Cold Email CTA Strategy

Because EpsiFlow is a straightforward infrastructure service, the CTA should not create unnecessary consulting friction.

Rather than asking for a 30-minute discovery call, the preferred CTA direction has been:

> If Shopify Ads are on your roadmap, I can send over the exact setup our clients' teams in India are using to get Shopify Ads running.

This works because it offers immediate value, feels informational rather than sales-heavy, directly resolves the pain introduced in the email, reduces commitment, and can lead naturally to registration.

The broader CTA principle is:

> Make the next step easier than continuing to research the payment problem independently.

## 17. Follow-Up Email Strategy

The cold-email follow-up framework is 2–3 follow-ups, with each follow-up being around 1–2 sentences.

The follow-up should refer back to the CTA from the first email and avoid repeating the entire pitch.

Possible angles include a reminder about the payment setup, opportunity cost of delaying Shopify Ads, cost savings versus existing payment arrangements, acknowledgment that the prospect may already be running ads, and a concise explanation that EpsiFlow may still improve payment efficiency.

It can make sense to mention that even companies already running Shopify Ads may be able to reduce cost or simplify payment operations through EpsiFlow, but only if the savings are real and quantifiable.

Subject lines do not necessarily need to change for every follow-up. Keeping follow-ups in the same thread is often useful because the original context remains visible.

## 18. Shopify Ads Optimization Partnership

EpsiFlow has also introduced a partnership around Shopify Ads optimization.

The partner mentioned in the project is **Öykü Sorgun**, a full-funnel growth and go-to-market consultant with more than 10 years of experience scaling Shopify apps and SaaS products.

The project notes state that she has worked with Instafeed, Fabrikatör, GoKwik, and Send to Many.

For EpsiFund subscribers, she was opening access to a Shopify Ads Optimization service before the service became public.

Two tiers were described: one for founders who want to manage the ads themselves with the right foundation, and another for founders who prefer to hand off the work.

The strategic value to EpsiFlow is important:

> EpsiFlow solves the ability-to-pay problem, while the optimization partnership helps customers get more value from the ad spend they are now able to deploy.

This creates a stronger customer lifecycle:

**payment access → campaign launch → campaign optimization → potentially higher customer success and retention**

## 19. Community Value

EpsiFlow may add customers to a Slack community.

The Slack community is not a hard requirement, but it can support customer support, peer interaction, Shopify ecosystem networking, announcements, partnerships, educational content, retention, cross-selling, and customer research.

Over time, the community can help EpsiFlow become more than a card provider.

That matters because a payment product can otherwise be vulnerable to commoditization if another bank, fintech, or card provider fixes the same payment problem.

## 20. Competitors and Alternatives

EpsiFlow competes not only against direct startups but against every alternative way a Shopify developer might solve the payment problem.

These alternatives include Indian bank forex cards, corporate cards, prepaid forex cards, virtual international cards, Wise or similar cross-border financial products, banking products from institutions such as ICICI, direct payment to Shopify using an existing card, another card-issuing fintech, an overseas company/bank-account setup, and other payment intermediaries.

An example raised in the project was the **ICICI Bank corporate forex prepaid card**.

The important competitive question is not whether such a product exists, but:

> Does it reliably work for the exact Shopify Ads billing flow, including merchant category rules, recurring/off-session transactions, foreign-currency requirements, authentication, and issuer restrictions?

If an ordinary bank product solves the problem reliably at lower cost, EpsiFlow's value proposition becomes weaker.

Competitive research should therefore test each alternative against the actual transaction behavior required by Shopify Ads rather than comparing marketing claims.

## 21. Why Customers May Not Simply Use Wise

One recurring customer objection is:

> Why can't the customer just use Wise or a forex card directly?

The response should be grounded in actual payment acceptance behavior.

Possible reasons include a product not being available to the business or jurisdiction, the card not supporting the required transaction type, recurring payments being restricted, merchant-category restrictions applying, 3DS/off-session authentication failing, Shopify or its billing processor rejecting the card, the customer needing a specific currency or billing profile, or funding mechanics still being difficult.

EpsiFlow should avoid saying that a particular alternative "does not work" universally unless this has been tested and documented.

The strongest claim is narrower:

> EpsiFlow is built around the specific workflow the customer is trying to execute, whereas a general-purpose forex or international card may or may not support it reliably.

## 22. Business Model

The EpsiFlow model generates revenue from Stripe-plan price differences and from EpsiFlow Direct subscription and transfer charges. The confirmed customer-facing price table is in Section 10.

Important commercial variables include fee per top-up, effective percentage charged to the customer, plan tiers, FX costs, card/network fees, banking or issuer fees, Stripe fees, EpsiFlow gross margin, refund costs, support costs, chargebacks, failed-payment costs, and compliance costs.

Customer-facing drafts should state both the Ads budget and total amount paid so customers do not need to reverse-engineer the cost.

## 23. Possible Pricing / Sales Positioning

A strong EpsiFlow pricing story should compare the fee to the value of solving the problem.

Customers are not paying merely for a virtual card.

They are potentially paying for payment access, reliable transaction execution, onboarding, banking setup, card issuance, operational support, spend visibility, invoices, saved founder time, faster advertising launch, reduced failed-payment risk, and partner/community access.

That said, if the service becomes materially more expensive than direct Shopify payment, prospects will compare the convenience premium against the cost.

This makes reliability critical.

A more expensive payment rail that still fails periodically is difficult to defend.

## 24. Customer Questions EpsiFlow Must Be Able to Answer Clearly

A strong customer or investor FAQ should be able to answer the following clearly:

- What exactly am I paying for?
- What does each plan cost?
- What percentage fee do I pay?
- Are there hidden FX fees?
- How is the card funded?
- Who issues the card?
- Who holds the customer funds?
- Is the money segregated?
- What happens if the bank/card provider fails?
- Is unused balance refundable?
- How long do refunds take?
- Are there refund fees or minimums?
- What happens if Shopify rejects a transaction?
- What happens if Stripe requires 3DS?
- Can the card be used outside Shopify Ads?
- What is prohibited?
- Can I increase my monthly spend?
- Can I cancel at any time?
- What happens to the card when I leave?
- How are invoices generated?
- What support is available?
- What compliance/KYC is required?
- Which countries are supported?

The quality of these answers will materially affect trust.

## 25. Customer Retention Drivers

Potential retention drivers include reliable card performance, convenient top-ups, low failure rates, fast issue resolution, transparent fees, spend tracking, invoice access, switching friction, Slack/community access, Shopify Ads optimization support, additional payment use cases, and customer success support.

The strongest retention mechanism should be ongoing utility rather than customer lock-in.

## 26. Key Product Risks

### Payment Dependency Risk

EpsiFlow depends on external payment providers, card issuers, banks, processors, and Shopify's billing stack. A change in one party's rules can disrupt the service.

### 3DS / Recurring Billing Risk

Failed off-session authentication can prevent automatic funding or subscription payments.

### Banking Partner Risk

If the bank/card arrangement changes, EpsiFlow may need to rebuild a major part of its infrastructure.

### Commoditization Risk

If Indian banks or fintechs begin offering cards that reliably work for Shopify Ads, the core problem may become easier to solve without EpsiFlow.

### Compliance Risk

Creating bank accounts, provisioning cards, holding or moving customer funds, and supporting cross-border payments can involve significant regulatory and compliance obligations.

The exact legal and regulatory framework is not defined in the project notes and should be reviewed professionally.

### Concentration Risk

A narrow dependence on Shopify Ads creates platform risk.

A Shopify policy, billing, or advertising change could materially affect the business.

### Trust Risk

Customers are placing money into a system and receiving a payment instrument.

Any ambiguity around custody, refunds, security, or legal responsibility can slow sales.

## 27. Acquisition / Business Purchase Context

A possible EpsiFlow acquisition was discussed at approximately:

- ARR: $6,000
- Purchase price: $25,000
- Clients: approximately 12

The $25,000 valuation was described as being based on five years of future cash flow discounted to present value.

The key acquisition concern was that the buyer might mainly be acquiring the customer base rather than durable infrastructure because the platform may need to be rebuilt, the card infrastructure may need to be recreated, banking/payment relationships may need to be re-established, and operational systems may not transfer cleanly.

This raises an important strategic question:

> Is EpsiFlow's durable asset the software, the financial infrastructure, the client relationships, the distribution, the brand, or some combination?

If the infrastructure is not transferable, customer relationships, operating knowledge, and acquisition channels become much more important in the valuation.

## 28. What Is Potentially Defensible About EpsiFlow

EpsiFlow's defensibility can come from several layers.

Infrastructure can include banking relationships, card issuance, proven payment routing, compliance processes, and operational know-how.

Distribution can include a concentrated database of Shopify developers, outbound systems, referral channels, partnerships, and community.

Customer knowledge can include detailed understanding of Shopify billing failure modes, India-specific customer problems, and payment troubleshooting knowledge.

The ecosystem can include optimization partners, Shopify growth experts, community relationships, and potentially additional Shopify-focused services.

The product can include spend tracking, invoice management, onboarding, account infrastructure, and automation around funding or payment recovery.

The more EpsiFlow evolves from "we give you a card" into "we are the financial and growth operations layer for Shopify app companies," the harder the business may become to replace with a single bank product.

## 29. Strategic Expansion Opportunities

Potential expansion directions include additional Shopify-related payment use cases, other advertising platforms, broader SaaS advertising payments, expense management, multi-card management, spend controls, team permissions, automated top-ups, failed-payment recovery, campaign reporting, Shopify Ads performance data, a growth consulting marketplace, finance/accounting integrations, improved invoice export, and broader countries beyond India.

Each expansion should remain close to a verified customer pain rather than turning EpsiFlow into a generic fintech product.

## 30. Recommended Positioning

A concise positioning statement:

> **EpsiFlow helps Shopify app companies in India run Shopify Ads without being blocked by payment-method restrictions. We provide the payment setup, card infrastructure, funding workflow, spend tracking, invoices, and support needed to get campaigns running.**

A more growth-oriented version:

> **EpsiFlow removes the payment infrastructure bottleneck that keeps Shopify app companies from launching and scaling Shopify Ads.**

A more operational version:

> **One setup for funding, paying for Shopify Ads, tracking spend, and managing invoices.**

## 31. Messaging Hierarchy

EpsiFlow messaging should generally follow this order.

First, lead with the desired outcome: run Shopify Ads and acquire more merchants.

Second, explain the obstacle: payment infrastructure from India can block or complicate Shopify Ads.

Third, explain the cost of that obstacle: delayed campaigns mean delayed acquisition and delayed learning.

Fourth, present the solution: EpsiFlow provides the working payment setup and operating layer.

Fifth, provide proof: existing Shopify app customers already use the setup.

Sixth, use a low-friction CTA: show the prospect the exact setup or let them register.

This is stronger than leading with card features.

Customers care about growth and operational certainty, not the spiritual fulfillment of possessing another virtual debit card.

## 32. Sales Objections to Prepare For

Common objections likely include "Why can't I use my bank card?", "Why can't I use Wise?", "Why should I pay your fee?", "What happens to unused money?", "Where is my money held?", "What happens if a payment fails?", "Can I cancel?", and "Are my funds safe?"

The answers should be specific, transparent, and based on the actual technical and legal setup rather than vague claims.

## 33. Customer Success Metrics

Useful EpsiFlow operating metrics may include number of active customers, monthly recurring revenue, annual recurring revenue, average revenue per customer, customer acquisition cost, churn, gross retention, net revenue retention, monthly funded volume, monthly Shopify Ads spend processed, gross payment volume, average customer ad spend, funding success rate, card transaction approval rate, failed transaction rate, 3DS failure rate, time from registration to first successful Shopify Ads payment, support tickets per customer, refund volume, average gross margin per customer, percentage of customers using the Slack community, and percentage using optimization partners.

For the core product, **time to first successful ad payment** and **payment success rate** are especially important.

## 34. Acquisition Metrics

For cold outbound, useful metrics include leads sourced, verified-email rate, open rate where technically reliable, reply rate, positive reply rate, qualified reply rate, setup sent, registrations, completed onboarding, first funded accounts, first successful Shopify Ads transaction, revenue per campaign, and acquisition cost per client.

The key funnel should not stop at "booked call."

A more meaningful funnel is:

**Lead → positive reply → registration → funded account → first successful ad payment → retained client**

## 35. Current Open Questions

### Commercial

What are the exact current plan prices? What is the exact effective fee percentage at each funding level? What is EpsiFlow's gross margin? Is there a minimum monthly commitment? Are there volume discounts? Are refunds free?

### Banking and Legal

Which bank or financial institution holds customer funds? Are balances held in the customer's name or EpsiFlow's name? Are funds segregated? Which entity issues the card? Which jurisdictions are supported? Which KYC/KYB rules apply? What activities are prohibited? What happens if the banking partner terminates the relationship?

### Product

Can users top up automatically? Can users self-serve card access without a call? Can cards be frozen or regenerated? Are spend limits configurable? Can the customer have multiple cards? How quickly do transactions appear in the dashboard? How are invoices generated? Does the system support webhooks or integrations?

### Shopify Ads

What exact Shopify Ads transaction type causes the Indian payment problem? Which cards/banks have been tested? What is the observed approval rate? Are failures tied to country, issuer, recurring transaction rules, 3DS, MCC, or currency? What is the documented success rate using EpsiFlow?

### Stripe / 3DS

What exact Stripe integration is currently used? Is SetupIntent used before future off-session charges? How are failed 3DS authentication attempts recovered? Are customers notified immediately? Can funding be designed to avoid unexpected authentication failures?

### Go-to-Market

Which ICP segment converts best? Does the strongest message focus on "cannot pay" or "save money"? What monthly ad-spend threshold creates the highest customer lifetime value? Which buying signals correlate with conversion? Which customer references can be publicly used?

## 36. Facts vs. Assumptions

### Confirmed or directly stated in the project

- EpsiFlow serves Shopify-related businesses.
- India is a primary customer acquisition market.
- A major use case is paying for Shopify Ads.
- Customers create an account in the EpsiFund app.
- EpsiFlow creates/provisions a bank account.
- EpsiFlow generates a digital debit card.
- Card details are transferred during a short call.
- Customers can track advertising spend and invoices in the EpsiFund account.
- Slack community access exists and is optional.
- Stripe subscriptions/top-ups have experienced 3DS-related incomplete statuses.
- Cold email acquisition through Instantly/Apollo has been explored.
- The acquisition strategy targets Shopify developers.
- Signals from LinkedIn, Twitter/X, Reddit, product launches, and partnerships have been considered.
- Öykü Sorgun Shopify Ads Optimization has been offered to EpsiFund subscribers.
- A historical acquisition discussion referenced approximately 12 clients and $6,000 ARR.
- A potential purchase price of $25,000 was discussed.

### Assumptions / strategic interpretations

- EpsiFlow may be able to evolve into a broader Shopify financial/growth operations platform.
- Smaller Shopify app companies may be the best ICP.
- The service may have defensibility through infrastructure, distribution, community, and partnerships.
- Opportunity-cost messaging may outperform purely technical payment messaging.
- The product may eventually support additional advertising platforms or broader SaaS spend.

These interpretations are strategically plausible but should be validated with customer and operating data.

## 37. One-Sentence Explanation

> **EpsiFlow helps Shopify app companies, especially in India, access a reliable payment setup for Shopify Ads and manage the related funding, spend, invoices, and support in one place.**

## 38. Short Sales Explanation

> Shopify app developers in India can know they need Shopify Ads and still get blocked by the payment setup. EpsiFlow gives them the banking and card infrastructure to pay for those ads, plus a dashboard for spend and invoices, so they can start running campaigns instead of troubleshooting payment methods.

## 39. Long-Term Strategic Idea

The most valuable version of EpsiFlow is probably not simply a virtual-card provider.

A stronger long-term category is:

> **Financial and growth infrastructure for Shopify app businesses.**

In this version, payment access is the initial wedge.

The broader platform could eventually help customers fund growth, pay advertising platforms, track spend, manage invoices, resolve payment failures, access growth specialists, benchmark acquisition, and participate in a Shopify-focused operator community.

That would make EpsiFlow useful before, during, and after the advertising transaction itself.

## 40. Final Summary

EpsiFlow exists to solve a narrow but commercially meaningful problem: Shopify app developers can be ready to advertise and still be prevented from doing so by their payment infrastructure.

The current solution combines account creation, banking setup, digital card issuance, Shopify Ads payment access, funding, spend tracking, invoices, onboarding support, optional community, and selected growth partnerships.

The current go-to-market strategy focuses primarily on Indian Shopify app companies and uses tightly targeted cold outbound.

The biggest opportunities are improving payment reliability, documenting pricing and fund custody clearly, proving the success rate of the payment setup, strengthening customer trust, and expanding the product from a card solution into a broader operating layer for Shopify app growth.

The biggest risks are dependence on financial partners and Shopify, payment failures, weak transferability of infrastructure, commoditization by banks/fintechs, and regulatory complexity.

At its core, EpsiFlow should sell **the ability to start and scale Shopify Ads without payment infrastructure becoming the bottleneck**.
