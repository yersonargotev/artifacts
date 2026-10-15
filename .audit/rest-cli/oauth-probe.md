# Public client revocation probe

Executed against the real migrated disposable fixture, with its DCR and PKCE grant helper. No production identity or secrets were used.

`POST /api/auth/oauth2/revoke` with public `client_id`, `token_type_hint=refresh_token` and the issued refresh token returned HTTP 200. The already issued access JWT still passed MCP whoami with HTTP 200.

The same endpoint with `token_type_hint=access_token` returned HTTP 400 and `unsupported_token_type`. Its description was `JWT access tokens are self-contained and cannot be revoked server-side`.

A CLI logout may revoke refresh credentials and remove local credentials. It must not claim immediate invalidation of copied access JWTs. Existing central-session revocation remains the immediate cross-client revocation boundary.
