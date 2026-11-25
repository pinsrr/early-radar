# Early Radar — Roblox trend tracker

Finds up-and-coming Roblox games **early**, and the gameplay mechanics behind them, before they go mainstream.

It runs free on GitHub: a scheduled GitHub Action collects public Roblox data every 30 minutes, stores the history in a `data` branch, and publishes a dark dashboard to GitHub Pages.

This is **Phase 1 + 2** of the roadmap: real data collection, historical snapshots, growth analysis, the Early Trend Score, mechanic tagging, the Mechanic Momentum Score, combinations, title patterns and alerts.

---

## Set up (about 10 minutes)

You need a free GitHub account. You don't need a server, an API key or a credit card.

1. **Create a new public repository** on GitHub, for example `early-radar`.
   Public repos get unlimited free Actions minutes. A private repo would use about 3,600 minutes a month, which is over the free 2,000. GitHub Pages also needs a paid plan for private repos.
2. **Upload the project files.** Unzip `early-radar.zip`. On the repo page, click **Add file → Upload files** and drag in *everything inside* the unzipped folder, including the hidden `.github` folder. Then click **Commit changes**.
   - On a Mac, press `Cmd+Shift+.` in Finder to show hidden folders.
   - If the upload skips `.github`, create the file by hand instead: **Add file → Create new file**, name it `.github/workflows/radar.yml`, and paste in the file's contents.
3. **Turn on Pages.** Go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. **Allow the workflow to write.** Go to **Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**, then click Save.
5. **Run it once now.** Go to **Actions → Early Radar → Run workflow**. A run takes about 2–3 minutes.
6. **Open the dashboard.** The link is at the top of the finished run, and also under **Settings → Pages**. It looks like `https://YOUR-NAME.github.io/early-radar/`.

After that, it runs every 30 minutes on its own.

### What to expect over time
| History | What works |
|---|---|
| First run | Discovery, live stats, mechanic tags. Growth uses a **cold-start estimate** (lifetime visits per day for the game's age), marked `*`. |
| 6 hours | Short-term CCU changes and visits per hour. |
| 48 hours | Real 24h growth against peers. Scores become trustworthy. |
| 3 days+ | Acceleration, consistency, decline detection, "plausible driver" confidence for mechanics. |
| 30 days | Full 7d/30d windows. Older raw data is rolled up into daily rows automatically. |

---

## How games are found (the early-discovery engine)

Each run:
- **Up-and-Coming and Top Trending lists** for "all" plus 7 rotating countries (18 in total). In testing, each country's Up-and-Coming list added 10–21 games that the global list didn't have.
- **Every explore sort** (Top Rated, Top Revisited, genre-trending lists…) every 4th run.
- **Deep keyword search**: 12 of 90 keywords per run, 3 pages deep. Deep pages reach games with as few as 5 players. Edit the keywords in `config/discovery.json`.
- **Live stats** for every tracked game, in batches of 50.
- Games that stay under 5 CCU for 7 days are paused. Paused games are re-checked once a day, so a revival is still caught.

## Scores

**Early Trend Score (0–100), per game.** Each game page shows the full breakdown.

| Factor | Points | Notes |
|---|---|---|
| Growth vs peers | 25 | Percentile against games of the **same genre and size** |
| Engagement | 15 | Like ratio, favourites per 1k visits, estimated session length |
| Acceleration | 10 | Growth today vs yesterday |
| Consistency | 10 | Share of days that went up |
| Freshness | 10 | Newer is better; older games reviving after an update also score |
| Earliness | 10 | Small **and** growing |
| Mechanic momentum | 10 | Best momentum among the game's mechanics |
| Discovery lists | 10 | Up-and-Coming in several countries, Top Trending |

Penalties: promo or bot spikes (−20), CCU rising without new visits (−15), poor like ratio (−8).

**Stages:** Early Signal → Emerging → Accelerating → Mainstream → Saturated or Declining.

**Mechanic Momentum Score (0–100)** is calculated over all games with that mechanic, whatever their genre:

- Adoption, growth of those games, independent creators and recency
- Acceleration and engagement
- **Lift vs same-genre games without it**
- Spread across genres and saturation
- Small-sample shrinkage (1–2 games can't make a trend)
- Social media attention is listed but not scored yet

**Correlation vs cause:** a mechanic is labelled **"plausible driver"** only when all of these hold:
- It is in 4 or more games.
- Those games come from 3 or more creators and 2 or more genres.
- They out-grow same-genre games without the mechanic.
- At least 40% of them are growing.

Otherwise it says **"correlation only"** or **"insufficient data"**.

**Title Patterns** finds title templates that different creators are copying, like "Steal a …" or "… For Animals". This is the "new mechanic" detector. When a pattern keeps growing, add a rule for it in `config/mechanics.json`.

## Data honesty

- **Observed:** CCU, visits, favourites, likes, genre, and created/updated dates, read from Roblox's public endpoints.
- **Derived:** growth and averages, computed from this tracker's own snapshots. Roblox gives no public history, so history starts on your first run.
- **Inferred:** session length, estimated as CCU ÷ visits per minute (Little's law). It's labelled as an estimate.
- **Not available:** retention and revenue. These are never shown or invented.
- **Baselines** compare against games this tracker has discovered, not all of Roblox.

Endpoints used, all verified working on 26 Nov 2026:
- `apis.roblox.com/explore-api/v1/get-sorts` and `get-sort-content`
- `apis.roblox.com/search-api/omni-search`
- `games.roblox.com/v1/games`
- `games.roblox.com/v1/games/votes`

These are the endpoints the Roblox website itself uses. They aren't a formally supported API, so they could change. The client retries with backoff, and the **Data & method** page shows failed and rate-limited requests for every run.

## Customise

- `config/mechanics.json`: mechanic keyword rules. Add patterns or new mechanics; no code needed.
- `config/discovery.json`: countries, keywords, run sizes and the tracked-game cap.
- `config/watchlist.json`: universe IDs that trigger an alert on any 24h move of 50% or more. A game's ID is the number in its dashboard URL (`#/game/ID`).

## Run on your own computer (optional)

With Node 20 or later installed:
```
npm test                                   # unit tests
npm run run                                # one live collection into ./store and ./site
node scripts/serve.js site 8080            # open http://localhost:8080
npm run fixture                            # offline replay of the included real snapshot
```

## Costs

| Item | Cost |
|---|---|
| GitHub Actions (public repo) | Free |
| GitHub Pages | Free |
| Storage | Free (`data` branch kept to a single commit; ~1 MB/day compressed, older days rolled up) |
| Roblox data | Free (public endpoints) |
| Optional later: YouTube Data API | Free quota (10k units/day) |
| Optional later: AI mechanic review | About US$2–5/month with the Claude API |

## Known limits

- GitHub can delay scheduled runs by 5–30 minutes when it's busy.
- GitHub pauses scheduled workflows in a repo after 60 days without commits. The data branch commits every run, which should keep it active. If runs ever stop, re-enable the workflow on the Actions tab.
- If Roblox starts rate-limiting GitHub's servers, the Data & method page will show it. Lower `keywordsPerRun` and `countriesPerRun`, or run the collector on your own PC.

## Roadmap

- **Phase 3 — Opportunity detection:** ranked white-space combinations, and three original concept briefs per emerging mechanic, with an optional AI writer.
- **Phase 4 — Automated research:** YouTube Data API coverage counts and whether social interest comes before or after growth, plus daily and weekly reports with a "What I Would Build Next" section, and Discord or email alerts.
- **Phase 5 — Predictive intelligence:** stored predictions checked at 7, 14 and 30 days; accuracy, false positives and lead time; score weights tuned on real outcomes.
