# Client Analytics Dashboard

Automated Instagram analytics tracking with daily reports and beautiful web dashboard.

## Features

- 📊 **Automated daily scraping** of Instagram metrics
- 📈 **Beautiful web dashboard** with real-time data
- 💬 **Discord notifications** with daily/weekly/monthly reports
- 📱 **Mobile-friendly** responsive design
- 🔄 **GitHub Actions** powered automation (runs daily at 6:45 AM CST)

## Setup Instructions

### 1. Create GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name it `client-analytics`
3. Make it **Public** (required for GitHub Pages)
4. Don't initialize with README

### 2. Add Files to Repository

1. Clone the repo locally:
   ```bash
   git clone https://github.com/sidney-afk/client-analytics.git
   cd client-analytics
   ```

2. Copy these files into the repo:
   - `scraper.py`
   - `.github/workflows/daily-scrape.yml`
   - `index.html`
   - `requirements.txt`
   - `README.md`

3. Create initial data directory:
   ```bash
   mkdir data
   echo '{"history":[],"latest":{},"changes":{}}' > data/metrics.json
   ```

4. Commit and push:
   ```bash
   git add .
   git commit -m "Initial setup"
   git push origin main
   ```

### 3. Configure Secrets

1. Go to your repo settings: `https://github.com/sidney-afk/client-analytics/settings/secrets/actions`
2. Click **New repository secret**
3. Name: `DISCORD_WEBHOOK_URL`
4. Value: (paste the Discord webhook URL you created)
5. Click **Add secret**

### 4. Enable GitHub Pages

1. Go to repo settings → **Pages**
2. Source: Deploy from branch
3. Branch: `main` / `root`
4. Click **Save**

Your dashboard will be live at: `https://sidney-afk.github.io/client-analytics/`

### 5. Run First Scrape

1. Go to **Actions** tab in your repo
2. Click **Daily Instagram Scrape** workflow
3. Click **Run workflow** → **Run workflow**
4. Wait ~1 minute for it to complete
5. Refresh your dashboard URL

## How It Works

### Daily Automation

- **Scraper** (`scraper.py`) uses Instaloader to pull Instagram metrics
- **GitHub Actions** runs the scraper daily at 6:45 AM CST
- **Data** is stored in `data/metrics.json` and committed to the repo
- **Dashboard** (`index.html`) reads the JSON and displays live metrics
- **Discord** receives a formatted report via webhook

### Metrics Tracked

- **Profile**: Followers, following, posts count
- **Engagement**: Likes, comments, engagement rate
- **Posts**: Last 12 posts with individual performance
- **Trends**: 30-day follower growth chart

## Customization

### Add More Clients

Edit `scraper.py` and change:
```python
INSTAGRAM_USERNAME = "bayavoce"  # Change to new client handle
```

Or create multiple scraper scripts (one per client).

### Change Report Schedule

Edit `.github/workflows/daily-scrape.yml`:
```yaml
cron: '45 12 * * *'  # Current: 6:45 AM CST (12:45 PM UTC)
```

Use [crontab.guru](https://crontab.guru/) to generate new schedules.

### Customize Dashboard

Edit `index.html` to change colors, layout, or add new metrics.

## Troubleshooting

### Scraper fails

- **Instagram blocks**: Instaloader might be rate-limited. Wait a few hours and retry.
- **Private accounts**: Only works with public Instagram profiles.
- **Network issues**: GitHub Actions might have connectivity issues. Retry manually.

### Dashboard not updating

- Check if GitHub Actions is running successfully (Actions tab)
- Make sure GitHub Pages is enabled and deployed from `main` branch
- Clear browser cache and refresh

### Discord reports not sending

- Verify webhook URL is correct in GitHub Secrets
- Check Discord webhook settings (should be active)

## Cost

- **GitHub Actions**: Free (2000 minutes/month for public repos)
- **GitHub Pages**: Free (100GB bandwidth/month)
- **Instaloader**: Free and open source

**Total monthly cost: $0**

## Support

Questions? Issues? Contact Alfredo in Discord.

---

Built with ❤️ by Alfredo
