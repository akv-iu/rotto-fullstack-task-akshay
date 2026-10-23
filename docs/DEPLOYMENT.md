# Vercel public demo

The hosted app uses a separate Supabase project. Do not use localhost URLs or copy the assessment's shared recruiter accounts into it.

1. Create a fresh project at https://supabase.com/dashboard. Choose a region near the Vercel function region you will use. Keep the database password in your password manager; the app uses API keys instead.
2. Open Supabase's SQL Editor. Run the complete contents of these files one at a time, in this order. Stop if any file fails:

   - `supabase/migrations/20261008000000_schema.sql`
   - `supabase/migrations/20261008000100_functions_security.sql`
   - `supabase/migrations/20261022000000_read_search.sql`
   - `supabase/migrations/20261023000000_public_demo.sql`

   Do not run `supabase/seed.sql` or `npm run db:setup` against the hosted project.
3. In Authentication settings, enable anonymous sign-ins. Turn off the Email provider for this demo; keep new-user signups allowed so anonymous visitors can be created. Do not enable CAPTCHA until the app also supplies a CAPTCHA token. See [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).
4. Copy the project URL, publishable key, and server secret key from the project's Connect/API Keys screens. See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys). In PowerShell, from the repository root, replace the placeholders and run:

   ```powershell
   npm ci
   $env:NEXT_PUBLIC_SUPABASE_URL='https://YOUR-PROJECT.supabase.co'
   $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='YOUR-PUBLISHABLE-KEY'
   $env:SUPABASE_SECRET_KEY='YOUR-SERVER-SECRET-KEY'
   node scripts/setup-data.mjs --candidates-only
   Remove-Item Env:NEXT_PUBLIC_SUPABASE_URL, Env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, Env:SUPABASE_SECRET_KEY
   ```

   Use Node 24. Success reports **5,000 candidates** and **no test accounts created**. The command can be rerun safely. Keep keys out of commits and screenshots; the shell will retain command history.
5. Commit and push the prepared application changes to GitHub. Vercel imports the pushed repository, not your local working files. Review `git diff` before committing; keep `.env` files and keys out of Git.
6. In Vercel, choose **Add New → Project**, import the GitHub repository, and select the branch containing these changes. Use Next.js, repository root `./`, Node **24.x**, install command `npm ci`, and build command `npm run build`. `prebuild` generates the vocabulary from committed data; Docker is not needed in Vercel.
7. Before deploying, add these [Vercel environment variables](https://vercel.com/docs/environment-variables) for Production (and Preview only if you want previews to use this same demo database):

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Hosted Supabase project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
   | `SUPABASE_SECRET_KEY` | Supabase server secret key |
   | `OPENAI_API_KEY` | Your OpenAI project API key |
   | `NEXT_PUBLIC_DEMO_MODE` | `true` |

   Mark `OPENAI_API_KEY` and `SUPABASE_SECRET_KEY` sensitive. They remain server-only; never add a `NEXT_PUBLIC_` prefix. Leave Stripe unconfigured: this demo does not sell subscriptions. If variables change after deployment, redeploy so public variables are rebuilt.
8. Click Deploy. Set Supabase Authentication's Site URL to the deployed HTTPS URL. Make sure Vercel deployment protection permits public access to the production URL. Open that production URL in a private browser window: it should start a demo session without a login screen.
9. Run a search, page through results, edit a filter, and create a shortlist. Open a separate browser or browser profile and verify that shortlist is not visible there. Test on a narrow phone screen. Review Vercel logs if a request fails; do not expose server errors to visitors.

Anonymous visitors get five new AI searches per UTC day. A database-enforced shared cap permits at most 100 demo search attempts per UTC day, including failed attempts. Filter edits and paging do not call OpenAI. Clearing browser data creates a new visitor, but cannot bypass the shared cap. OpenAI spending alerts are useful as a second signal, not a replacement for this cap.

Anonymous workspaces currently persist. Add scheduled cleanup if traffic grows; deleting a visitor's workspace also deletes their demo shortlists and searches. The local test suite changes seeded data: run it only against the local Docker database, never the hosted demo database.
