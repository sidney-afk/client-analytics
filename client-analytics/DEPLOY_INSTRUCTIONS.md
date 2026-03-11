# 🚀 Deploy Instructions

## What You Need to Do

### 1. Push to GitHub (5 minutes)

Run these commands in your terminal:

```bash
cd client-analytics
git add .
git commit -m "Update scraper and dashboard with smart anomaly detection"
git push origin main
```

That's it! Your new scraper and dashboard are now on GitHub.

---

### 2. Set Up Google Service Account (10 minutes)

The GitHub Action needs permission to write to your Google Sheet.

#### Step 1: Create Service Account
1. Go to https://console.cloud.google.com/
2. Select your project (or create one)
3. Navigate to **APIs & Services** → **Credentials**
4. Click **Create Credentials** → **Service Account**
5. Give it a name like "GitHub Actions Scraper"
6. Click **Done** (skip optional steps)

#### Step 2: Generate Key
1. Click on the service account you just created
2. Go to **Keys** tab
3. Click **Add Key** → **Create new key**
4. Choose **JSON** format
5. Download the JSON file (keep it safe!)

#### Step 3: Share Sheet with Service Account
1. Open the JSON file you downloaded
2. Find the `"client_email"` field (looks like `something@project-id.iam.gserviceaccount.com`)
3. Open your Google Sheet: https://docs.google.com/spreadsheets/d/1iZ7OL_B1XWrLnL8CzoH3xOGCANIl5UTY_oX0NBz-HlI
4. Click **Share** button
5. Paste the service account email
6. Give it **Editor** access
7. Uncheck "Notify people" and click **Share**

#### Step 4: Add Secret to GitHub
1. Go to your GitHub repo: https://github.com/sidney-afk/client-analytics
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `GOOGLE_SERVICE_ACCOUNT_JSON`
5. Value: **Paste the ENTIRE contents of the JSON file you downloaded**
6. Click **Add secret**

---

### 3. Test It! (2 minutes)

#### Manual Test
1. Go to your repo on GitHub
2. Click **Actions** tab
3. Click **Daily SocialBlade Scrape** workflow
4. Click **Run workflow** → **Run workflow**
5. Wait ~2 minutes
6. Check if the workflow succeeded (green checkmark)
7. Check your Google Sheet - new data should appear!

#### Automatic Daily Runs
- The scraper will now run **every day at 9 AM EST**
- No further action needed!
- Check the Actions tab to see logs

---

### 4. View Your Dashboard

Your dashboard is live at:
**https://sidney-afk.github.io/client-analytics/dashboard.html**

(GitHub Pages should auto-update from your `main` branch)

If it's not working:
1. Go to repo **Settings** → **Pages**
2. Under "Source", select **main** branch
3. Click **Save**
4. Wait 1-2 minutes, then visit the URL above

---

## What's Been Set Up

✅ **Smart scraper** with anomaly detection
✅ **3-tab dashboard** (Daily, Weekly, Monthly)
✅ **GitHub Actions** for daily automation
✅ **Google Sheets** integration

---

## Files Updated

- `scraper.py` - Local scraper (use with `gog` CLI)
- `scraper_github.py` - GitHub Actions version (uses Google API)
- `dashboard.html` - New 3-tab dashboard
- `.github/workflows/daily-scrape.yml` - Automation workflow
- `requirements.txt` - Python dependencies

---

## Troubleshooting

**Workflow fails with "GOOGLE_APPLICATION_CREDENTIALS not set"**
- You forgot step 2.4 - add the secret to GitHub

**Workflow succeeds but no data appears**
- Check if you shared the sheet with the service account (step 2.3)
- Make sure you gave "Editor" access (not "Viewer")

**Dashboard shows old data**
- Hard refresh: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
- GitHub Pages can take 1-2 minutes to update

**Want to change the time?**
- Edit `.github/workflows/daily-scrape.yml`
- Change the cron line: `'0 14 * * *'` (currently 9 AM EST)
- Use https://crontab.guru/ to pick your time

---

## Next Steps

Once everything is working:
1. Let it run for 7 days → Weekly charts will populate
2. Let it run for 30 days → Monthly charts will be fully filled
3. Check the Actions tab daily to ensure scrapes succeed
4. Review anomalies in the workflow logs

**You're done!** 🎉
