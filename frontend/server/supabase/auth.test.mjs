import assert from "node:assert/strict";
import test from "node:test";

import { SupabaseAuthService } from "./auth.mjs";

function responseRecorder() {
  return {
    cookies: [],
    append(name, value) {
      if (name === "Set-Cookie") this.cookies.push(value);
    },
  };
}

test("account sessions stay in HttpOnly cookies", async () => {
  const session = {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_in: 3600,
  };
  const service = new SupabaseAuthService({
    client: {
      auth: {
        async signInWithPassword(credentials) {
          return {
            data: {
              user: { id: "user-1", email: credentials.email },
              session,
            },
            error: null,
          };
        },
      },
    },
  });
  const result = await service.signIn({
    email: "collector@example.com",
    password: "safe-password",
  });
  const response = responseRecorder();
  service.setSessionCookies(response, result.session);
  assert.equal(result.user.email, "collector@example.com");
  assert.equal(response.cookies.length, 2);
  assert.match(response.cookies[0], /HttpOnly/);
  assert.match(response.cookies[0], /SameSite=Lax/);
  assert.doesNotMatch(response.cookies[0], /Secure/);
});

test("an expired access token refreshes once for concurrent requests", async () => {
  let refreshCalls = 0;
  const service = new SupabaseAuthService({
    client: {
      auth: {
        async getUser() {
          return { data: { user: null }, error: new Error("expired") };
        },
        async refreshSession() {
          refreshCalls += 1;
          return {
            data: {
              user: { id: "user-1", email: "collector@example.com" },
              session: {
                access_token: "new-access",
                refresh_token: "new-refresh",
                expires_in: 3600,
              },
            },
            error: null,
          };
        },
      },
    },
  });
  const request = {
    headers: { cookie: "cardpilot_access=old; cardpilot_refresh=refresh" },
  };
  const [first, second] = await Promise.all([
    service.userFromRequest(request, responseRecorder()),
    service.userFromRequest(request, responseRecorder()),
  ]);
  assert.equal(first.id, "user-1");
  assert.equal(second.id, "user-1");
  assert.equal(refreshCalls, 1);
});

test("invalid account inputs are rejected before reaching Supabase", () => {
  const service = new SupabaseAuthService({ client: { auth: {} } });
  assert.throws(
    () => service.validateCredentials({ email: "bad", password: "short" }),
    /Invalid email address|Too small/,
  );
});

test("password reset uses the configured CardPilot recovery page", async () => {
  let request;
  const service = new SupabaseAuthService({
    emailRedirectTo: "https://cardpilot.example/",
    client: {
      auth: {
        async resetPasswordForEmail(email, options) {
          request = { email, options };
          return { error: null };
        },
      },
    },
  });
  await service.requestPasswordReset({ email: "collector@example.com" });
  assert.deepEqual(request, {
    email: "collector@example.com",
    options: { redirectTo: "https://cardpilot.example/account/reset-password" },
  });
});

test("recovery tokens establish a server-side cookie session", async () => {
  const session = {
    access_token: "new-access-token-that-is-long-enough",
    refresh_token: "new-refresh-token-that-is-long-enough",
    expires_in: 3600,
  };
  const service = new SupabaseAuthService({
    client: { auth: {} },
    clientFactory: () => ({
      auth: {
        async setSession(tokens) {
          assert.equal(tokens.access_token, session.access_token);
          return {
            data: {
              user: { id: "user-1", email: "collector@example.com" },
              session,
            },
            error: null,
          };
        },
      },
    }),
  });
  const result = await service.establishRecoverySession({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
  });
  const response = responseRecorder();
  service.setSessionCookies(response, result.session);
  assert.equal(result.user.id, "user-1");
  assert.equal(response.cookies.length, 2);
  assert.match(response.cookies[0], /HttpOnly/);
});

test("account deletion uses the administrative client", async () => {
  let deletedUser;
  const service = new SupabaseAuthService({
    client: { auth: {} },
    adminClient: {
      auth: {
        admin: {
          async deleteUser(userId, softDelete) {
            deletedUser = { userId, softDelete };
            return { error: null };
          },
        },
      },
    },
  });
  await service.deleteUser("user-1");
  assert.deepEqual(deletedUser, { userId: "user-1", softDelete: false });
});
