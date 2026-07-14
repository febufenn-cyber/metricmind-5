# Phase 5: Product frontend and onboarding

## Objective

Phase 5 exposes the trusted backend through an accessible, responsive application served from the Cloudflare Worker.

## Product surfaces

- connection onboarding with session, reader-role verification, freshness, and semantic health;
- question composer with verified answers, chart specifications, confidence, evidence, and lineage;
- bounded investigation workspace with approved dimensions, observations, hypotheses, contradictions, and saved history;
- semantic catalog with immutable version and health visibility;
- session configuration for bearer token and selected organization.

## Security and accessibility

- strict Content Security Policy and security headers on all frontend assets;
- no third-party scripts or runtime dependencies;
- bearer tokens are stored in session storage only;
- organization selection is stored separately and still validated by the API membership boundary;
- dynamic content is inserted with `textContent`, not interpreted as HTML;
- semantic landmarks, labels, skip navigation, keyboard focus, live regions, contrast, responsive layout, and reduced-motion handling;
- causal status and uncertainty remain visible in investigation results.

## Architecture

`src/app-worker.js` serves the application at `/`, `/app`, and `/assets/*`, then delegates all API routes to the existing authenticated Worker. The UI does not duplicate metric, SQL, authorization, or evidence logic.

## Exit gate

A user can configure a session, test the read-only connection, inspect health, ask a question, run an investigation, browse investigation history, and inspect verified metrics and evidence through one responsive application. Production deployment still requires real Supabase and Cloudflare credentials.
