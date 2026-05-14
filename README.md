# Adcraft Human Review Dashboard

This is a Vercel-ready static dashboard for human review of generated form templates.

## What it does

- Loads review items from a local JSON seed or an uploaded TSV/CSV export
- Shows a queue filtered by campaign, date, status, and search
- Embeds the selected form template in an iframe
- Gives reviewers a notes area and a checklist for:
  - `Title Review`
  - `H1 Ends With Form`
  - `FAQ Review`
  - `Available Fields`
  - `Form-Use Case Field`
  - `Field Count Review`
  - `Consent Rule Review`
  - `Sensitive Fields Review`
- Opens the L2 ticket page from a dedicated button
- Exports review results to CSV

## Current persistence model

This first version stores review edits in browser `localStorage`.

That means:

- fast to ship
- no backend needed for the MVP
- not shared across reviewers yet

If you want team-shared notes and review state, the next step is to add a backend data store or sync adapter.

## File structure

```text
review-dashboard/
  index.html
  styles.css
  app.js
  data/sample-review-items.json
```

## How to use locally

From the `review-dashboard` directory, run a static server. For example:

```bash
cd /Users/cerenbozada/Documents/Playground/review-dashboard
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173
```

## How to load real review data

Prepare a TSV or CSV with columns like:

- `Template URL`
- `Original Template Title`
- `Template ID`
- `Use Case`
- `Keyword`
- `Generated Date`
- `Campaign Name`
- `Display Campaign`
- `Review Status`
- `Review Decision`
- `Reviewer`
- `Reviewed At`
- `Review Notes`
- `Priority`

Optional review columns already supported:

- `Title Review`
- `H1 Ends With Form`
- `FAQ Review`
- `Available Fields Review`
- `Form-Use Case Field`
- `Field Count Review`
- `Consent Rule Review`
- `Sensitive Fields Review`

Use the `Upload TSV or CSV` button in the dashboard to load the file.

## GitHub and Vercel flow

1. Create a GitHub repo and push the `review-dashboard` folder.
2. In Vercel, import that repo.
3. Set the root directory to `review-dashboard`.
4. Use the `Other` preset if Vercel asks for a framework.
5. Leave the build command empty for a pure static deployment.
6. Deploy.

## Recommended next phase

After the MVP is live, the best upgrade path is:

1. add shared persistence for review notes and statuses
2. connect the dashboard to your sheet export or internal endpoint
3. prefill the L2 ticket flow with template context if the L2 page accepts query parameters or a handoff payload
