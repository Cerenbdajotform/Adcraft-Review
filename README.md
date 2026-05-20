# Adcraft Human Review Dashboard

This dashboard is now built for shared human review on Vercel.

## What changed

- Review data can stay shared across reviewers
- `Save Review` can write to a shared Supabase-backed store
- `Upload TSV or CSV` can replace the shared queue for the day
- The dashboard still falls back to local browser mode when shared storage is not configured yet

## How shared storage works

The frontend is still plain `HTML/CSS/JS`, but Vercel now serves three API routes:

- `GET /api/data`
- `POST /api/reviews`
- `POST /api/dataset`

Those routes now prefer Supabase for shared persistence and can fall back to a GitHub-backed JSON state when needed.

Primary shared store:

- Supabase table row storage

Optional fallback shared store:

- GitHub-backed JSON state

If you use the GitHub fallback, one important detail:

- shared review commits go to a separate branch by default
- that branch is `review-data`
- this avoids triggering a new production deploy on every review save

## Vercel environment variables

Add these in the Vercel project settings for `Adcraft-Review`:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Recommended optional variables:

- `SUPABASE_TABLE=review_dashboard_state`
- `SUPABASE_STATE_ROW_ID=primary`
- `OPENAI_API_KEY`
- `OPENAI_MODEL=gpt-5-mini`
- `GITHUB_BASE_BRANCH=main`
- `GITHUB_DATA_BRANCH=review-data`
- `GITHUB_STATE_PATH=data/review-dashboard-state.json`
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`

## Supabase setup

Run this SQL in the Supabase SQL editor:

```sql
\i supabase/review_dashboard_state.sql
```

If the SQL editor does not accept `\i`, paste the contents of:

- `supabase/review_dashboard_state.sql`

Then add:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

The dashboard API uses the service role key on the server side, so reviewers do not need direct database credentials in the browser.

## OpenAI review connection

The dashboard can now use OpenAI as the review engine for `GET /api/ai-review`.

Add these Vercel environment variables:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Recommended model:

- `OPENAI_MODEL=gpt-5-mini`

How it behaves:

- when `OPENAI_API_KEY` exists, the API sends the extracted template title, meta description, description paragraphs, FAQ content, field labels, and rule signals to OpenAI
- OpenAI returns a structured review with:
  - `suggestedDecision`
  - `summary`
  - 8 check results
- when `OPENAI_API_KEY` is missing or the model call fails, the endpoint falls back to the built-in rule-based review logic

The frontend will show:

- `OpenAI gpt-5-mini` in the AI review meta line when the OpenAI path is active
- `Rule-based fallback` when it is not

## GitHub fallback

If you want GitHub as a backup path, create a fine-grained GitHub personal access token with:

- repository: `Adcraft-Review`
- permission: `Contents` set to `Read and write`

Then add:

- `GITHUB_TOKEN`
- `GITHUB_OWNER=Cerenbdajotform`
- `GITHUB_REPO=Adcraft-Review`

## Local and shared behavior

When the Supabase environment variables exist:

- the dashboard loads shared data from Supabase
- uploads replace the shared review queue
- saves update the shared review state

When Supabase is not configured but the GitHub environment variables exist:

- the dashboard loads shared data from GitHub
- uploads replace the shared review queue
- saves update the shared review state

When the environment variables do not exist:

- the dashboard loads bundled seed data
- review saves stay in browser `localStorage`
- uploads stay local to that browser session

## Data file

The local seed file is:

- `data/review-dashboard-state.json`

The Supabase schema file is:

- `supabase/review_dashboard_state.sql`

It stores:

- template queue rows
- review checklist values
- reviewer notes
- decision and priority
- last update metadata

## Current review fields

- `Title Review`
- `H1 Ends With Form`
- `FAQ Review`
- `Available Fields`
- `Form-Use Case Field`
- `Field Count Review`
- `Consent Rule Review`
- `Sensitive Fields Review`

## Deployment

The project still deploys on Vercel with the same setup:

- `Application Preset`: `Other`
- `Root Directory`: `/`
- `Build Command`: empty
- `Output Directory`: empty

After adding the Vercel environment variables, redeploy once so the API routes can use them.
