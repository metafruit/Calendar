import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

loadEnvFile();

const port = process.env.PORT || 4173;
const root = process.cwd();
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const publicBaseUrl = process.env.PUBLIC_BASE_URL || "";
const sessionCookieName = "calendar_skin_session";
const oauthStateCookieName = "calendar_skin_oauth_state";
const sessions = new Map();

function loadEnvFile() {
  try {
    const text = readFileSync(".env", "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed
        .slice(separatorIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // A .env file is optional. Environment variables still work.
  }
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const send = (res, status, body, contentType = "text/plain; charset=utf-8") => {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
};

const toJson = (res, status, payload) => {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
};

const redirect = (res, location) => {
  res.writeHead(302, { location });
  res.end();
};

const setCookie = (res, name, value, options = {}) => {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];

  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.secure) parts.push("Secure");

  const current = res.getHeader("set-cookie");
  const cookies = Array.isArray(current) ? current : current ? [current] : [];
  res.setHeader("set-cookie", [...cookies, parts.join("; ")]);
};

const clearCookie = (res, name) => {
  setCookie(res, name, "", { maxAge: 0 });
};

const parseCookies = (req) => {
  const header = req.headers.cookie || "";
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...value] = part.split("=");
        return [name, decodeURIComponent(value.join("="))];
      })
  );
};

const readJsonBody = async (req) => {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const getBaseUrl = (req) => {
  if (publicBaseUrl) return publicBaseUrl.replace(/\/$/, "");

  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto || "http";
  return `${protocol}://${req.headers.host}`;
};

const getRedirectUri = (req) => `${getBaseUrl(req)}/auth/google/callback`;

const isGoogleConfigured = () => Boolean(googleClientId && googleClientSecret);

const getSession = (req) => {
  const sessionId = parseCookies(req)[sessionCookieName];
  if (!sessionId) return null;
  return sessions.get(sessionId) || null;
};

const requireSession = async (req, res) => {
  const session = getSession(req);

  if (!session) {
    toJson(res, 401, { error: "Sign in with Google first." });
    return null;
  }

  try {
    await ensureAccessToken(session);
    return session;
  } catch {
    toJson(res, 401, { error: "Google sign-in expired. Please sign in again." });
    return null;
  }
};

const isAllowedCalendarUrl = (url) => {
  if (url.protocol !== "https:") return false;
  return (
    url.hostname === "calendar.google.com" ||
    url.hostname === "www.google.com" ||
    url.hostname === "calendar.googleusercontent.com"
  );
};

const normalizeCalendarUrl = (url) => {
  const directIcs = url.pathname.endsWith(".ics") || url.pathname.includes("/ical/");
  if (directIcs) return url;

  if (url.hostname === "calendar.google.com" && url.pathname.includes("/calendar/embed")) {
    const source = url.searchParams.get("src");
    if (source) {
      return new URL(
        `https://calendar.google.com/calendar/ical/${encodeURIComponent(source)}/public/basic.ics`
      );
    }
  }

  return url;
};

const ensureAccessToken = async (session) => {
  if (session.expiresAt && session.expiresAt - 60_000 > Date.now()) {
    return session.accessToken;
  }

  if (!session.refreshToken) {
    throw new Error("Missing refresh token.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: session.refreshToken,
      grant_type: "refresh_token"
    })
  });

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error_description || "Could not refresh Google token.");
  }

  session.accessToken = payload.access_token;
  session.expiresAt = Date.now() + payload.expires_in * 1000;
  return session.accessToken;
};

const fetchGoogleJson = async (session, url, options = {}) => {
  const accessToken = await ensureAccessToken(session);
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=utf-8",
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  const payload = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    throw new Error(payload.error?.message || payload.error_description || "Google API request failed.");
  }

  return payload;
};

const mapGoogleEvent = (event) => {
  const allDay = Boolean(event.start?.date);
  const startValue = event.start?.dateTime || event.start?.date;
  const endValue = event.end?.dateTime || event.end?.date || startValue;

  return {
    id: event.id,
    title: event.summary || "Untitled event",
    location: event.location || "",
    description: event.description || "",
    start: startValue,
    end: endValue,
    allDay
  };
};

const addDaysToDateString = (dateString, days) => {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const safeJsonParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

const server = createServer(async (req, res) => {
  let requestUrl;

  try {
    requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);

    if (requestUrl.pathname === "/api/auth/me") {
      const session = getSession(req);
      return toJson(res, 200, {
        configured: isGoogleConfigured(),
        signedIn: Boolean(session),
        user: session?.user || null
      });
    }

    if (requestUrl.pathname === "/auth/google") {
      if (!isGoogleConfigured()) {
        return toJson(res, 500, {
          error: "Google OAuth is not configured on this server."
        });
      }

      const state = randomBytes(18).toString("hex");
      setCookie(res, oauthStateCookieName, state, {
        maxAge: 10 * 60,
        secure: getBaseUrl(req).startsWith("https:")
      });

      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.search = new URLSearchParams({
        client_id: googleClientId,
        redirect_uri: getRedirectUri(req),
        response_type: "code",
        scope: [
          "openid",
          "email",
          "profile",
          "https://www.googleapis.com/auth/calendar.events"
        ].join(" "),
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
        state
      }).toString();

      return redirect(res, authUrl.toString());
    }

    if (requestUrl.pathname === "/auth/google/callback") {
      const cookies = parseCookies(req);
      const expectedState = cookies[oauthStateCookieName];
      const receivedState = requestUrl.searchParams.get("state");
      const code = requestUrl.searchParams.get("code");

      clearCookie(res, oauthStateCookieName);

      if (!expectedState || expectedState !== receivedState || !code) {
        return send(res, 400, "Google sign-in could not be verified.");
      }

      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: googleClientId,
          client_secret: googleClientSecret,
          redirect_uri: getRedirectUri(req),
          grant_type: "authorization_code"
        })
      });
      const tokenPayload = await tokenResponse.json();

      if (!tokenResponse.ok) {
        return send(res, 400, tokenPayload.error_description || "Google sign-in failed.");
      }

      const userResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { authorization: `Bearer ${tokenPayload.access_token}` }
      });
      const user = userResponse.ok ? await userResponse.json() : null;
      const sessionId = randomBytes(32).toString("hex");

      sessions.set(sessionId, {
        accessToken: tokenPayload.access_token,
        refreshToken: tokenPayload.refresh_token,
        expiresAt: Date.now() + tokenPayload.expires_in * 1000,
        user: user
          ? {
              name: user.name,
              email: user.email,
              picture: user.picture
            }
          : null
      });

      setCookie(res, sessionCookieName, sessionId, {
        maxAge: 60 * 60 * 24 * 30,
        secure: getBaseUrl(req).startsWith("https:")
      });

      return redirect(res, "/");
    }

    if (requestUrl.pathname === "/api/auth/logout") {
      const sessionId = parseCookies(req)[sessionCookieName];
      if (sessionId) sessions.delete(sessionId);
      clearCookie(res, sessionCookieName);
      return toJson(res, 200, { signedIn: false });
    }

    if (requestUrl.pathname === "/api/events") {
      const session = await requireSession(req, res);
      if (!session) return;

      if (req.method === "GET") {
        const timeMin = requestUrl.searchParams.get("timeMin");
        const timeMax = requestUrl.searchParams.get("timeMax");
        const calendarId = requestUrl.searchParams.get("calendarId") || "primary";
        const calendarUrl = new URL(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
        );
        calendarUrl.search = new URLSearchParams({
          singleEvents: "true",
          orderBy: "startTime",
          timeMin,
          timeMax,
          maxResults: "2500"
        }).toString();
        const payload = await fetchGoogleJson(session, calendarUrl);
        return toJson(res, 200, {
          events: (payload.items || []).map(mapGoogleEvent)
        });
      }

      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const calendarId = body.calendarId || "primary";
        const timeZone = body.timeZone || "America/New_York";
        const title = String(body.title || "").trim();

        if (!title) {
          return toJson(res, 400, { error: "Event title is required." });
        }

        const eventBody = {
          summary: title,
          location: body.location || "",
          description: body.description || ""
        };

        if (body.allDay) {
          if (!body.date) return toJson(res, 400, { error: "Date is required." });
          eventBody.start = { date: body.date };
          eventBody.end = { date: addDaysToDateString(body.date, 1) };
        } else {
          if (!body.start || !body.end) {
            return toJson(res, 400, { error: "Start and end times are required." });
          }
          eventBody.start = { dateTime: body.start, timeZone };
          eventBody.end = { dateTime: body.end, timeZone };
        }

        const created = await fetchGoogleJson(
          session,
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
          {
            method: "POST",
            body: JSON.stringify(eventBody)
          }
        );

        return toJson(res, 201, { event: mapGoogleEvent(created) });
      }

      return toJson(res, 405, { error: "Method not allowed." });
    }

    if (requestUrl.pathname === "/api/calendar") {
      const calendarUrl = requestUrl.searchParams.get("url");

      if (!calendarUrl) {
        return toJson(res, 400, { error: "Missing calendar URL." });
      }

      let target;
      try {
        target = new URL(calendarUrl);
      } catch {
        return toJson(res, 400, { error: "That does not look like a URL." });
      }

      if (!isAllowedCalendarUrl(target)) {
        return toJson(res, 400, {
          error: "Use a public Google Calendar iCal URL."
        });
      }

      const normalizedTarget = normalizeCalendarUrl(target);
      const response = await fetch(normalizedTarget, {
        headers: { "user-agent": "custom-calendar-skin/1.0" }
      });

      if (!response.ok) {
        return toJson(res, response.status, {
          error: `Google Calendar returned ${response.status}.`
        });
      }

      const text = await response.text();
      const looksLikeCalendar = text.includes("BEGIN:VCALENDAR");

      if (!looksLikeCalendar) {
        return toJson(res, 400, {
          error:
            "That Google Calendar link did not return an iCal feed. Use the Public address in iCal format, or a public embed link with a src calendar id."
        });
      }

      res.writeHead(200, {
        "content-type": "text/calendar; charset=utf-8",
        "cache-control": "no-store"
      });
      return res.end(text);
    }

    const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const filePath = normalize(join(root, pathname));

    if (!filePath.startsWith(root)) {
      return send(res, 403, "Forbidden");
    }

    const file = await readFile(filePath);
    send(res, 200, file, mimeTypes[extname(filePath)] || "application/octet-stream");
  } catch (error) {
    if (error.code === "ENOENT") {
      return send(res, 404, "Not found");
    }

    console.error(error);
    if (requestUrl?.pathname.startsWith("/api/")) {
      return toJson(res, 500, {
        error: error.message || "Something went wrong"
      });
    }

    send(res, 500, "Something went wrong");
  }
});

server.listen(port, () => {
  console.log(`Custom Calendar Skin is running at http://localhost:${port}`);
});
