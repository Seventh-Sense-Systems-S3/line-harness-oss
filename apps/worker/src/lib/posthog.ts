import { PostHog } from 'posthog-node';

/**
 * Create a per-request PostHog client for Cloudflare Workers.
 *
 * Workers are serverless — each invocation is short-lived.
 * flushAt: 1 and flushInterval: 0 ensure events are sent immediately
 * rather than batched, which would be lost when the worker terminates.
 */
export function createPostHogClient(apiKey: string, host: string): PostHog {
  return new PostHog(apiKey, {
    host,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  });
}
