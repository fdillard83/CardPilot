import { z } from "zod";

const CredentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
}).strict();

const ACCESS_COOKIE = "cardpilot_access";
const REFRESH_COOKIE = "cardpilot_refresh";

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator < 0) return [part, ""];
        return [
          decodeURIComponent(part.slice(0, separator)),
          decodeURIComponent(part.slice(separator + 1)),
        ];
      }),
  );
}

function cookie(name, value, { maxAge = 0, secure = false } = {}) {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : null,
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function publicUser(user) {
  return user ? { id: user.id, email: user.email ?? null } : null;
}

export class SupabaseAuthService {
  constructor({ client, secureCookies = false, emailRedirectTo = null }) {
    this.client = client;
    this.secureCookies = secureCookies;
    this.emailRedirectTo = emailRedirectTo;
    this.refreshes = new Map();
  }

  validateCredentials(input) {
    return CredentialsSchema.parse(input);
  }

  async signUp(input) {
    const credentials = this.validateCredentials(input);
    const options = this.emailRedirectTo
      ? { emailRedirectTo: this.emailRedirectTo }
      : undefined;
    const { data, error } = await this.client.auth.signUp({
      ...credentials,
      ...(options ? { options } : {}),
    });
    if (error) throw error;
    return {
      user: publicUser(data.user),
      session: data.session,
      confirmationRequired: Boolean(data.user && !data.session),
    };
  }

  async signIn(input) {
    const credentials = this.validateCredentials(input);
    const { data, error } = await this.client.auth.signInWithPassword(credentials);
    if (error) throw error;
    return { user: publicUser(data.user), session: data.session };
  }

  async userFromRequest(request, response) {
    const cookies = parseCookies(request.headers.cookie);
    const accessToken = cookies[ACCESS_COOKIE];
    if (accessToken) {
      const { data, error } = await this.client.auth.getUser(accessToken);
      if (!error && data?.user) return publicUser(data.user);
    }

    const refreshToken = cookies[REFRESH_COOKIE];
    if (!refreshToken) return null;
    try {
      const refreshed = await this.#refresh(refreshToken);
      if (!refreshed?.session || !refreshed.user) return null;
      this.setSessionCookies(response, refreshed.session);
      return refreshed.user;
    } catch {
      this.clearSessionCookies(response);
      return null;
    }
  }

  setSessionCookies(response, session) {
    if (!session?.access_token || !session?.refresh_token) return;
    response.append(
      "Set-Cookie",
      cookie(ACCESS_COOKIE, session.access_token, {
        maxAge: session.expires_in ?? 3600,
        secure: this.secureCookies,
      }),
    );
    response.append(
      "Set-Cookie",
      cookie(REFRESH_COOKIE, session.refresh_token, {
        maxAge: 60 * 60 * 24 * 30,
        secure: this.secureCookies,
      }),
    );
  }

  clearSessionCookies(response) {
    response.append(
      "Set-Cookie",
      cookie(ACCESS_COOKIE, "", { secure: this.secureCookies }),
    );
    response.append(
      "Set-Cookie",
      cookie(REFRESH_COOKIE, "", { secure: this.secureCookies }),
    );
  }

  async #refresh(refreshToken) {
    const existing = this.refreshes.get(refreshToken);
    if (existing) return existing.promise;
    const promise = this.client.auth
      .refreshSession({ refresh_token: refreshToken })
      .then(({ data, error }) => {
        if (error) throw error;
        return {
          user: publicUser(data.user),
          session: data.session,
        };
      });
    const entry = { promise };
    this.refreshes.set(refreshToken, entry);
    setTimeout(() => {
      if (this.refreshes.get(refreshToken) === entry) {
        this.refreshes.delete(refreshToken);
      }
    }, 10_000).unref?.();
    return promise;
  }
}

export function requireCloudUser(authService) {
  return async (request, response, next) => {
    try {
      const user = await authService.userFromRequest(request, response);
      if (!user) {
        response.status(401).json({
          error: "Sign in to access your CardPilot collection.",
        });
        return;
      }
      request.cardPilotUser = user;
      next();
    } catch (error) {
      console.error("CardPilot account verification failed", error);
      response.status(503).json({
        error: "CardPilot could not verify your account. Please try again.",
      });
    }
  };
}
