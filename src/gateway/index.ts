/**
 * @module gateway/index
 *
 * Public barrel export for the gateway package. Re-exports the core Gateway
 * server class together with its configuration and message types, as well as
 * the CSRF protection and rate-limiting utilities used by the gateway.
 */

/** Core WebSocket gateway server and its associated configuration/message types. */
export { Gateway, GatewayConfig, GatewayClient, GatewayMessage } from "./gateway";

/** HMAC-based CSRF token generation and validation. */
export { CsrfProtection } from "./csrf";

/** Sliding-window rate limiter for per-client request throttling. */
export { RateLimiter } from "./rate-limiter";
