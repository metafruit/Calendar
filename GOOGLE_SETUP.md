# Google Sign-In Setup

This app can read and create Google Calendar events after you add Google OAuth credentials.

1. Go to Google Cloud Console.
2. Create or choose a project.
3. Enable the Google Calendar API.
4. Configure the OAuth consent screen.
5. Create an OAuth Client ID with application type `Web application`.
6. Add an authorized redirect URI that exactly matches the app callback:

```text
http://localhost:4177/auth/google/callback
```

For a Cloudflare Tunnel demo, use the tunnel URL instead:

```text
https://YOUR-TUNNEL.trycloudflare.com/auth/google/callback
```

7. Start the app with the credentials:

Option A: create a `.env` file from `.env.example`, fill it in, then run:

```sh
node server.js
```

Option B: pass the credentials directly:

```sh
GOOGLE_CLIENT_ID="..." GOOGLE_CLIENT_SECRET="..." PUBLIC_BASE_URL="http://localhost:4177" PORT=4177 node server.js
```

The app asks Google for profile/email plus Calendar events permission so it can list and create events.
