// Design sketch only. Bodies intentionally remain unimplemented.
type Opaque<Name extends string> = string & { readonly __name: Name };
export type UserId = Opaque<"UserId">;
export type SessionId = Opaque<"SessionId">;
export type ClientId = Opaque<"ClientId">;
export type Issuer = Opaque<"Issuer">;
export type Resource = Opaque<"Resource">;
export type Scope = "openid" | "profile" | "offline_access"
	| "artifacts:read" | "artifacts:write" | "artifacts:publish";
export type ArtifactScope = Extract<Scope, `artifacts:${string}`>;
export type IdentityBinding = Readonly<{
	userId: UserId; sessionId: SessionId; clientId: ClientId;
}>;
declare const admitted: unique symbol;
export type Principal = IdentityBinding & Readonly<{
	scopes: ReadonlySet<Scope>; [admitted]: true;
}>;
export type Credential = { kind: "missing" }
	| { kind: "access-token"; value: string };
export type AuthorizationNeed =
	| { kind: "resource"; scopes: readonly ArtifactScope[] }
	| { kind: "panel"; boundTo: IdentityBinding };
export type Admission = { kind: "allowed"; principal: Principal }
	| { kind: "unauthenticated"; reason: "missing" | "invalid" | "inactive" }
	| { kind: "insufficient-scope"; required: readonly ArtifactScope[] }
	| { kind: "unavailable" };
export type ResourcePolicy = Readonly<{ issuer: Issuer; audience: Resource }>;
type TokenFacts = IdentityBinding & Readonly<{
	scopes: ReadonlySet<Scope>; expiresAt: number;
}>;
type LiveSession = IdentityBinding & Readonly<{ scopes: ReadonlySet<Scope> }>;
export interface VerificationPort {
	// Adapter verifies signature, pinned algorithms, issuer, audience, expiry, and sid.
	verify(token: string, policy: ResourcePolicy): Promise<
		{ kind: "verified"; facts: TokenFacts } | { kind: "invalid" } | { kind: "unavailable" }
	>;
	// One authenticated provider call per valid protected request. No positive cache.
	introspect(token: string): Promise<
		{ kind: "active"; session: LiveSession } | { kind: "inactive" } | { kind: "unavailable" }
	>;
	now(): number;
}
export type Authorizer = (credential: Credential, need: AuthorizationNeed) => Promise<Admission>;
export function createAuthorizer(policy: ResourcePolicy, effects: VerificationPort): Authorizer {
	// TODO verify, obtain fresh introspection, then evaluate matching user/sid/client.
	// TODO reject stale expiry, intersect granted scopes, and check the panel binding.
	throw new Error("not implemented");
}
function decide(facts: TokenFacts, session: LiveSession, need: AuthorizationNeed, now: number): Admission {
	throw new Error("not implemented");
}
// Private dashboard row. Tokens are server-only. Cookie holds only an opaque handle.
type PanelSessionRow = Readonly<{
	handleHash: string; identity: IdentityBinding; expiresAt: number;
	accessToken: string; refreshToken: string; accessExpiresAt: number;
}>;
// packages/db derives row types from its authoritative schema rather than copying this sketch.
