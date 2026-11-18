# InsightGenius AI — Goal Tree (production starter)

A one-page web app where members:

- sign in with an email link (no passwords)
- build a visual **goal tree**: big goals branch from "My Journey", and steps branch from goals, to any depth; branches expand and collapse
- edit any goal: title, long/short-term, progress, notes, mark complete, delete
- press **✦** to have Claude break a goal into 3–15 steps (each new step also gets 2–3 learning resources)
- open **Resources** for any step: videos, classes, books, events and communities, each with a search link to check it
- press **Do** to run an AI agent on a step ("Do it for me"): it drafts, researches or plans, adds follow-up steps, and lists anything that needs your approval (nothing is ever sent for you)
- press **Plan my day** for an AI schedule built from all goals and their progress
- switch between Night and Day mode
- have a fair-use limit on AI (default **10 requests per 3 hours** per member; resources for brand-new AI steps are free)

Everything is saved to a real database, and each member can only see their own goals.

| Piece | Service | Why |
|---|---|---|
| Web app | **Next.js** on **Vercel** | One page, plus one server route for AI |
| Sign-in and database | **Supabase** | Email login and a Postgres database with per-user security |
| AI | **Claude API** (Anthropic) | Breakdowns and suggestions; the API key stays on the server |

---

## Launch it (about 30–45 minutes, no coding)

### 1. Create the database (Supabase)
1. Sign up at **supabase.com** and click **New project**. Pick a region near your users and save the database password.
2. Open **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, and click **Run**. You should see "Success".
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Get a Claude API key (Anthropic)
1. Sign up at **console.anthropic.com**.
2. Add a payment method under **Billing**. AI usage is pay-as-you-go.
3. Go to **API Keys → Create key** and copy it (it starts with `sk-ant-`). Keep it secret.
4. Optional: set a **monthly spend limit** in the Console so costs can never surprise you.

### 3. Put the code on GitHub
1. Create a free account at **github.com**, then click **New repository** (private is fine).
2. Click **uploading an existing file** and drag in everything in this folder *except* `node_modules` and `.next` (if present). Commit.

### 4. Deploy (Vercel)
1. Sign up at **vercel.com** with your GitHub account and click **Add New → Project**. Import your repository.
2. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon public key |
   | `ANTHROPIC_API_KEY` | your `sk-ant-...` key |

3. Click **Deploy**. You'll get an address like `https://insightgenius-goals.vercel.app`.

### 5. Connect sign-in to your address (Supabase)
1. In Supabase, open **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel address, and add the same address under **Redirect URLs**.
3. Open your site, enter your email, click the link in the email, and you're in.

---

## Upgrading an existing install to Goal Tree v2
Paste the whole of `supabase/migrations/002_goal_tree_v2.sql` into **Supabase → SQL Editor → New query** and click **Run** (safe to run twice). Vercel redeploys the code by itself when it lands on `main`.

## Optional settings (Vercel → Settings → Environment Variables)

| Name | Default | What it does |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | Which Claude model to use. `claude-haiku-5-5` is cheaper and faster. |
| `AI_LIMIT_PER_WINDOW` | `10` | AI requests allowed per member per window |
| `AI_LIMIT_WINDOW_HOURS` | `3` | Length of the window, in hours |

Redeploy after changing a variable.

## Run it on your own computer (optional, for developers)
```bash
cp .env.example .env.local   # then fill in the values
npm install
npm run dev                  # open http://localhost:3000
```
Add `http://localhost:3000` to Supabase's Redirect URLs for local sign-in.

---

## Before you charge real customers
- **Hosting plan:** Vercel's free Hobby plan is for non-commercial use only. Move to **Vercel Pro** once you charge, or intend to charge, users.
- **Database plan:** Supabase free projects pause after a week with no activity. Use **Supabase Pro** for an always-on app.
- **Email sending:** Supabase's built-in email is meant for testing and sends only a few emails per hour. Connect your own email provider (such as Resend, Postmark or SendGrid) under **Authentication → Emails → SMTP Settings**.
- **Custom domain:** add yours in Vercel → **Domains**, then update Supabase's Site URL and Redirect URLs to match.
- **Legal:** publish a privacy policy and terms of service, and have a lawyer review them.
- **Payments:** add Stripe Checkout when you're ready to sell plans. A small follow-up change can tie the AI limit to each member's plan.

## How many people can it serve?
There's no fixed limit in the code; capacity comes from your service plans:
- **Sign-ins:** the Supabase free plan covers 50,000 monthly active users and Pro covers 100,000, with more available for a per-user fee.
- **Web traffic:** Vercel scales automatically.
- **AI:** your Anthropic account's usage tier sets the rate limits, which rise as you use and pay more. The per-member limit keeps costs predictable.

## What's in the folder
```
app/page.js            the page: sign-in, saving, and wiring everything together
components/GoalTree.js draws the tree
components/Panels.js   edit, resources, "Do it for me", today's plan, delete dialog
app/api/ai/route.js    server route for ✦ breakdown, resources and Plan my day
app/api/agent/route.js server route for the "Do it for me" agent (streams its progress)
lib/server/ai.js       shared server code: sign-in check, AI limit, Claude calls
lib/supabaseClient.js  browser connection to Supabase
supabase/schema.sql    tables plus security rules (paste into Supabase)
.env.example           list of settings you need
```

## Security notes
- Row Level Security means each member can only read and change their own goals, even if someone tampers with the browser.
- The Claude key lives only on the server and is never sent to the browser.
- The AI route reads goals from the database rather than trusting text sent by the browser, and logs every request for the usage limit. Members can't delete those log rows.
