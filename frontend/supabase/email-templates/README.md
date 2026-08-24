# CardPilot authentication email

Supabase sends registration mail, so its hosted Auth template must match the application template.

In the production Supabase project, open **Authentication → Email Templates → Confirm signup** and set:

- Subject: `Verify your CardPilot email address`
- Body: the contents of `confirm-signup.html`

Also set the sender name to `CardPilot` under the production SMTP settings. Keep `{{ .ConfirmationURL }}` unchanged so Supabase can insert the secure, single-use verification link.
