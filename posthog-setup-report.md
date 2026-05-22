<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the LINE Harness OSS Cloudflare Worker. A per-request `PostHog` client is created using `createPostHogClient()` (in `src/lib/posthog.ts`) with `flushAt: 1` and `flushInterval: 0` — the correct configuration for serverless/edge environments where the process does not persist between requests. The PostHog API key and host are read from Cloudflare Worker environment bindings (`POSTHOG_API_KEY`, `POSTHOG_HOST`), which are set in `.dev.vars` for local development and must be added as Wrangler secrets for production (`wrangler secret put POSTHOG_API_KEY --env production`).

Ten business-critical events were instrumented across six route files, covering the full user lifecycle from LINE follow through payment and churn.

| Event | Description | File |
|---|---|---|
| `line_friend_followed` | A user followed the LINE official account | `apps/worker/src/routes/webhook.ts` |
| `line_friend_unfollowed` | A user unfollowed the LINE official account | `apps/worker/src/routes/webhook.ts` |
| `line_message_received` | A LINE message was received from a user | `apps/worker/src/routes/webhook.ts` |
| `broadcast_sent` | A broadcast message was sent to friends | `apps/worker/src/routes/broadcasts.ts` |
| `stripe_payment_succeeded` | A Stripe payment was completed successfully | `apps/worker/src/routes/stripe.ts` |
| `stripe_subscription_cancelled` | A Stripe subscription was cancelled | `apps/worker/src/routes/stripe.ts` |
| `conversion_tracked` | A conversion event was recorded for a friend | `apps/worker/src/routes/conversions.ts` |
| `form_submitted` | A user submitted a LIFF form | `apps/worker/src/routes/forms.ts` |
| `tracked_link_clicked` | A tracked link was clicked | `apps/worker/src/routes/tracked-links.ts` |
| `friend_message_sent` | A manual direct message was sent to a friend | `apps/worker/src/routes/friends.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- [Analytics basics dashboard](/dashboard/1569817)
- [LINE Friend Follows Over Time](/insights/PZKRqbOh) — daily follow trend
- [LINE Message Volume](/insights/DB5Jd7yx) — inbound vs outbound message volume
- [LINE Engagement Funnel](/insights/YO3rQTXJ) — Follow → Message → Form Submit conversion funnel
- [Revenue Events](/insights/9lXyrvQy) — Stripe payments, conversions, and cancellations
- [Broadcast & Tracked Link Performance](/insights/Rx8iy8do) — broadcast sends vs link clicks

**Production setup required:** Add PostHog secrets to Cloudflare:
```bash
wrangler secret put POSTHOG_API_KEY --env production
wrangler secret put POSTHOG_HOST --env production
```

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
