# Metricmind

> chat copilot that answers 'why did signups drop?' by querying your product events and returning charts plus a written diagnosis.

**Alternative to the product-shape pioneered by Amplitude (YC W12)** — rank #5 of 500 in the [YC-500 Fable 5 Venture Blueprint](https://github.com/) (score 7.35/10).

## Why this exists
Public company; proves durable demand for deep behavioral analytics. The buildable wedge: ai copilot that answers product questions over an existing warehouse.

## MVP scope
- [ ] NL-to-SQL over events
- [ ] auto-chart
- [ ] anomaly callouts
- [ ] saved questions
- [ ] Slack answers

## Architecture
`Workers+Supabase+Claude; connect user's Postgres` — Cloudflare Workers + Hono API, Supabase (Postgres + RLS + Auth + pgvector), Claude API via Agent SDK (claude-fable-5 for agent reasoning, claude-haiku-4-5 for volume), wrangler deploys.

**Integrations:** Anthropic; Supabase; Slack; user Postgres/BigQuery
**Data:** Read-only access to product event tables + schema
**Agent core:** Core: agent plans queries, runs them, and narrates findings end-to-end.

## Business
| | |
|---|---|
| Monetization | Per-seat SaaS plus query volume |
| First customer | PM/growth teams already on a warehouse |
| GTM wedge | Content on 'chat with your product data', PLG free trial |
| Competition risk | High: every BI vendor adds copilots |
| Regulatory/trust risk | Med: data access trust |
| India angle | Serves lean Indian growth teams lacking dedicated data analysts. |
| Difficulty / build time | Medium / 4-6 weeks |

## 30-day plan
- **W1:** core loop — NL-to-SQL over events + auto-chart
- **W2:** anomaly callouts + saved questions + Slack answers + auth + billing
- **W3:** polish, instrument events, seed first users via: Content on 'chat with your product data', PLG free trial
- **W4:** launch + first revenue; kill/scale decision

---
*Built with Fable 5 (Claude Code). Blueprint row: inspired by Amplitude — "Enterprise digital analytics: product analytics, experimentation, CDP, session replay."*