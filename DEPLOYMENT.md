# CardPilot private Render deployment

CardPilot deploys as one Node web service. Express serves both the API and the
built Vite application. Collection records and images remain in Supabase; no
durable user data depends on Render's local filesystem.

## Create the service

1. Sign in to Render and select **New > Blueprint**.
2. Connect the `fdillard83/CardPilot` GitHub repository.
3. Render detects the root `render.yaml` file and proposes a `cardpilot` web
   service.
4. Keep the Free instance while CardPilot is in private testing. It sleeps
   after inactivity and can take about a minute to wake up.

## Enter private environment values

Render prompts for every value marked `sync: false`. Copy the corresponding
values from the local `frontend/.env` file; never paste them into `render.yaml`
or any tracked file.

- `APP_ORIGIN`: initially use the final Render address, such as
  `https://cardpilot.onrender.com`. If Render has not assigned it yet, finish
  creating the service and then set this value in the service's Environment
  page before the final deploy.
- `OPENAI_API_KEY`
- `EBAY_CLIENT_ID`
- `EBAY_CLIENT_SECRET`
- `THE_CARD_API_KEY`
- `POKEMON_TCG_API_KEY` (optional; leave empty if no key is available)
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Do not create a `PORT` value. Render supplies the listening port automatically.

## Allow the production address in Supabase

In **Supabase > Authentication > URL Configuration**:

1. Change **Site URL** to the HTTPS Render address.
2. Add the HTTPS Render address to **Redirect URLs**.
3. Add `<Render address>/account/reset-password` to **Redirect URLs**.
4. Keep the localhost reset URL while local development continues.

Example:

```text
https://cardpilot.onrender.com
https://cardpilot.onrender.com/account/reset-password
http://localhost:5173/account/reset-password
```

## Production acceptance checks

1. Open `/api/health` and verify it returns `"ok": true`.
2. Sign in and confirm the existing collection and images appear.
3. Upload and identify a test card.
4. Confirm it appears on both the computer and iPhone.
5. Refresh active-market and sold-comparison data.
6. Sign out and sign back in.
7. Request one password-reset email and verify its link returns to the HTTPS
   CardPilot address.

Account deletion should be tested only with a temporary account.
