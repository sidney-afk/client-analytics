# Quick Setup Guide

Follow these steps to get your analytics dashboard running in ~10 minutes.

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `client-analytics`
3. Description: "Automated Instagram analytics dashboard"
4. **Make it PUBLIC** (required for free GitHub Pages)
5. Don't check any boxes (no README, no .gitignore, no license)
6. Click **Create repository**

## Step 2: Upload Files

You have two options:

### Option A: Upload via GitHub Web (Easiest)

1. On your new repo page, click **uploading an existing file**
2. Drag and drop ALL these files:
   - `scraper.py`
   - `index.html`
   - `requirements.txt`
   - `README.md`
   - `.gitignore`
   - `SETUP.md`
3. Create folder structure:
   - Click **Create new file**
   - Type: `.github/workflows/daily-scrape.yml`
   - Paste the content from `daily-scrape.yml`
   - Commit
4. Create data folder:
   - Click **Create new file**
   - Type: `data/metrics.json`
   - Paste: `{"history":[],"latest":{},"changes":{}}`
   - Commit

### Option B: Use Git Command Line

```bash
# Clone the repo
git clone https://github.com/sidney-afk/client-analytics.git
cd client-analytics

# Copy all files into this folder
# (drag and drop from the folder I sent you)

# Add and commit
git add .
git commit -m "Initial setup"
git push origin main
```

## Step 3: Add Discord Webhook Secret

1. Go to: `https://github.com/sidney-afk/client-analytics/settings/secrets/actions`
2. Click **New repository secret**
3. Name: `DISCORD_WEBHOOK_URL`
4. Value: (paste your Discord webhook URL)
5. Click **Add secret**

## Step 4: Enable GitHub Pages

1. Go to: `https://github.com/sidney-afk/client-analytics/settings/pages`
2. Under "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: **main** / **root**
3. Click **Save**
4. Wait ~2 minutes

Your dashboard will be live at:
**https://sidney-afk.github.io/client-analytics/**

## Step 5: Run First Scrape

1. Go to the **Actions** tab: `https://github.com/sidney-afk/client-analytics/actions`
2. Click **Daily Instagram Scrape** (left sidebar)
3. Click **Run workflow** (blue button)
4. Click **Run workflow** again
5. Wait ~30 seconds for it to finish
6. Refresh your dashboard URL

You should see metrics appear!

## That's It!

The scraper now runs automatically every day at 6:45 AM CST.

- **Dashboard**: https://sidney-afk.github.io/client-analytics/
- **Discord reports**: Posted to #analytics daily at 7 AM CST
- **Manual runs**: Go to Actions tab anytime to trigger manually

## Troubleshooting

**"Actions tab doesn't show workflows"**
- Make sure the `.github/workflows/daily-scrape.yml` file exists in the repo

**"Dashboard shows 404"**
- GitHub Pages takes 2-5 minutes to build. Wait and refresh.
- Make sure repo is PUBLIC

**"Scraper fails"**
- Check if @bayavoce Instagram is public (not private)
- Instagram might rate-limit. Wait an hour and retry.

**"No Discord reports"**
- Verify webhook URL is correctly added to Secrets
- Check webhook isn't expired/deleted in Discord

---

Need help? Ask Alfredo in Discord! 🍝
