# Expired-session recovery — 3 November 2026

The reported 401 warnings were followed by successful page loads, as confirmed by the user. That indicates the existing automatic refresh/retry flow was recovering. A brief unauthorized response when an access token expires is expected; protected endpoints must continue rejecting missing or invalid authentication.

The frontend nevertheless cached a successful `/auth/me` result indefinitely. It now revalidates that cache after 30 seconds of active use, sharing one in-flight check among concurrent requests. Concurrent and delayed 401 responses reuse the latest successful refresh instead of rotating the refresh token again unnecessarily. A request that remains unauthorized after retry clears the cached session and returns to login. Temporary refresh-server/network failures remain retryable, and 403 permission failures preserve the session.

Login now verifies the session before showing a welcome message and opening the dashboard, with a clear error if the session cannot be confirmed.

The existing JWT/session validation, HttpOnly/Secure cookie settings, MFA requirements and company/branch authorization remain in force. The localhost production-cookie case was verified in Chrome. No database records, sessions, credentials or `.env` values were changed by verification.

Validation uses the actual frontend API client bundled for a browser, an isolated local fixture server, and synthetic cookies. Seven checks cover production-style cookies, cached-session expiration, parallel/late 401s, terminal unauthorized responses, expired refresh tokens, permission failures, and recovery from a temporary 503. The existing 20 frontend tests pass. See `auth-recovery-verification.json`.

After building the backend, re-run the isolated authentication checks with `bun scripts/verify-auth-recovery.mjs`, optionally passing the frontend repository path. The script does not contact the live API or database.
