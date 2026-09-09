# EpsiFlow public website

Standalone Sites website within the EpsiFlow workspace, separate from `../dashboard` and the existing EpsiFund customer application. No dashboard modules, credentials, customer records, or database connections are included.

## Development

Run `npm install`, then `npm run dev` in this folder. `npm run build` creates a static HTML deployment with no application server. The Sites project is recorded in `.openai/hosting.json`.

## Content and design

Product positioning is based on `../docs/acquisition/epsiflow_overview.md`. Commercial terms come from `../database/migrations/037_authoritative_epsiflow_pricing.sql` (operator-confirmed 2026-08-24). The monthly plan price is the total monthly payment, distinct from the advertising budget. EpsiFlow Direct uses the confirmed $66 monthly fee and approximately $91 per transfer.

The primary action links to the existing customer app at https://app.epsifund.com/. The page collects no data itself and includes no analytics or marketing cookies. No fabricated customer logos, testimonials, payment guarantees, or regulatory claims are used. The hero artwork is conceptual, not a depiction of an issued card.

Design: modern B2B marketing, custom CSS over the Sites/shadcn foundation; green accent, Geist typography, system light/dark mode. Taste skill dials: DESIGN_VARIANCE 5, MOTION_INTENSITY 3, VISUAL_DENSITY 4. Restrained interaction motion suits a payment-related service. Layout, content and SEO are rendered to HTML at build time. The FAQ uses a client interaction; the pricing table reuses the bundled UI primitive.

If connecting a custom domain, update the canonical origin in `app/layout.tsx`, `public/robots.txt`, and `public/sitemap.xml` together. Sites audience settings control public access separately from these SEO files.
