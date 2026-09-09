'use client';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
const questions = [
  ['Who is EpsiFlow for?', 'EpsiFlow primarily helps Shopify app developers and Shopify SaaS businesses in India whose existing cards or banking setup make it difficult to pay for Shopify Ads. The team confirms eligibility and intended spend during onboarding.'],
  ['What is the difference between EpsiFlow and EpsiFund?', 'EpsiFlow is the service that helps you set up and fund advertising payments. EpsiFund is the customer application where you create your account, view transactions and spending, and access invoices.'],
  ['Does EpsiFlow run my advertising campaigns?', 'You manage your campaigns in Shopify. EpsiFlow provides the payment setup and related support, so you have a way to fund eligible advertising spend.'],
  ['How do I receive my digital card?', 'After your account is created and the payment setup is provisioned, the team arranges a short call to hand over your card details and help you understand how to use them.'],
  ['What happens if my account runs low on funds?', 'Advertising payments can be rejected when there are insufficient funds. Monitor your available balance in EpsiFund and allow time to fund your account before it runs low.'],
  ['Can I use the card for other business expenses?', 'Shopify Ads is the core use case. Other advertising or online business expenses depend on eligibility. Confirm the intended use with the EpsiFlow team before making payments.'],
];
export function Faq() { return <Accordion className="faq-list" defaultValue={['question-0']}>{questions.map(([question,answer],index)=><AccordionItem key={question} value={`question-${index}`}><AccordionTrigger className="faq-trigger">{question}</AccordionTrigger><AccordionContent className="faq-answer"><p>{answer}</p></AccordionContent></AccordionItem>)}</Accordion>; }
