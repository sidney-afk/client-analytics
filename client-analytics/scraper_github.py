#!/usr/bin/env python3
"""
GitHub Actions compatible scraper
Uses Google Sheets API directly (no gog CLI needed)
"""

import requests
import json
import time
import os
from datetime import datetime
from bs4 import BeautifulSoup
from google.oauth2 import service_account
from googleapiclient.discovery import build

SHEET_ID = "1iZ7OL_B1XWrLnL8CzoH3xOGCANIl5UTY_oX0NBz-HlI"
RANGE_NAME = "Sheet1!A:E"

# Anomaly detection parameters
FOLLOWER_THRESHOLD = 500
VIEW_FOLLOWER_RATIO_MIN = 5
HISTORICAL_MULTIPLIER = 8
MIN_HISTORY_COUNT = 3

CLIENTS = [
    # Jessica Winterstern
    {"name": "Jessica Winterstern", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UCbg4YuPi0hrXVqz9XoMkGRA"},
    {"name": "Jessica Winterstern", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/thefeminineheart"},
    {"name": "Jessica Winterstern", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/thefeminineheart"},
    
    # Morgan Burton
    {"name": "Morgan Burton", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UCX4KEhXS_HRAxRmqulpIW8w"},
    {"name": "Morgan Burton", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/morgancarringtonburton"},
    {"name": "Morgan Burton", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/morgancarringtonburton"},
    
    # Dr. Sonia Chopra
    {"name": "Dr. Sonia Chopra", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UC_caIBdFY1E_KhlWamMkl9A"},
    {"name": "Dr. Sonia Chopra", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/drsoniachopra"},
    {"name": "Dr. Sonia Chopra", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/drsoniachopra"},
    
    # Alyssa Nobriga
    {"name": "Alyssa Nobriga", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UCtvvqCw3YZRJsbPMOWzBQ7Q"},
    {"name": "Alyssa Nobriga", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/alyssanobriga"},
    {"name": "Alyssa Nobriga", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/alyssanobriga"},
    
    # Doug Cartwright
    {"name": "Doug Cartwright", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/doug_cartwright"},
    {"name": "Doug Cartwright", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/doug_cartwright"},
    
    # Dr. Rocco Piazza
    {"name": "Dr. Rocco Piazza", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UC6bPEuBQ8lVb_uEDxKHwObg"},
    {"name": "Dr. Rocco Piazza", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/roccopiazzamd"},
    {"name": "Dr. Rocco Piazza", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/piazzacenter"},
    
    # Edward Mannix
    {"name": "Edward Mannix", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UCXUWnzLRnHvV1aFRUKJGePA"},
    {"name": "Edward Mannix", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/edwardmannix"},
    {"name": "Edward Mannix", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/edward.mannix"},
    
    # Alli Schaper
    {"name": "Alli Schaper", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UClHiIkO01iVRz39WwxWx-kg"},
    {"name": "Alli Schaper", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/allischaper"},
    
    # Eben & Annie
    {"name": "Eben & Annie", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/annie_and_eben"},
    
    # Baya Voce
    {"name": "Baya Voce", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UCPu4owIqTTxo9AmSedA0nqg"},
    {"name": "Baya Voce", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/bayavoce"},
    {"name": "Baya Voce", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/bayavoce"},
    
    # Jordan Marks
    {"name": "Jordan Marks", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UCUtl5MPeU827dt3TPmU3BgA"},
    {"name": "Jordan Marks", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/jordan_mindbody"},
    {"name": "Jordan Marks", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/jordan.mindbody"},
    
    # Miki Agrawal
    {"name": "Miki Agrawal", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UCQiZvvqE9ZQCfK4yGDeCHcw"},
    {"name": "Miki Agrawal", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/mikiagrawal"},
    {"name": "Miki Agrawal", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/mikiagrawal"},
    
    # Erica Matluck
    {"name": "Erica Matluck", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/drericamatluck"},
    
    # Natalie MacNeil
    {"name": "Natalie MacNeil", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UC_gNaN7_2GKTrQfFQvBguow"},
    {"name": "Natalie MacNeil", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/nataliemacneil"},
    
    # John Wineland
    {"name": "John Wineland", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UCTif0aTpBjQ27lRC5q6vJLw"},
    {"name": "John Wineland", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/john_wineland"},
    {"name": "John Wineland", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/john_wineland"},
    
    # David Kessler
    {"name": "David Kessler", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UC3nSTGZ3mBqgQTfSuZ5Bl9A"},
    {"name": "David Kessler", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/iamdavidkessler"},
    {"name": "David Kessler", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/iamdavidkessler"},
    
    # Chelsey Scaffidi
    {"name": "Chelsey Scaffidi", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/chelseyscaffidi"},
    {"name": "Chelsey Scaffidi", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/chelseyscaffidi"},
    
    # Danielle Robin
    {"name": "Danielle Robin", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/dani__robin"},
    
    # Morgan Burch
    {"name": "Morgan Burch", "platform": "YouTube", "url": "https://socialblade.com/youtube/channel/UCjF8q8v46XqehBI_jrG_2HA"},
    {"name": "Morgan Burch", "platform": "Instagram", "url": "https://socialblade.com/instagram/user/goodmorgantherapy"},
    {"name": "Morgan Burch", "platform": "TikTok", "url": "https://socialblade.com/tiktok/user/goodmorgantherapy"},
]


def get_sheets_service():
    """Initialize Google Sheets API client"""
    creds_json = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if not creds_json:
        raise ValueError("GOOGLE_APPLICATION_CREDENTIALS env var not set")
    
    # If it's a file path, read it
    if os.path.exists(creds_json):
        creds = service_account.Credentials.from_service_account_file(
            creds_json,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
    else:
        # It's JSON string
        creds_data = json.loads(creds_json)
        creds = service_account.Credentials.from_service_account_info(
            creds_data,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
    
    return build('sheets', 'v4', credentials=creds)


def fetch_historical_data(service):
    """Fetch existing data from Google Sheets"""
    try:
        result = service.spreadsheets().values().get(
            spreadsheetId=SHEET_ID,
            range=RANGE_NAME
        ).execute()
        
        rows = result.get('values', [])
        if len(rows) < 2:
            return {}
        
        history = {}
        for row in rows[1:]:  # Skip header
            if len(row) < 5:
                continue
            
            date, client, platform, followers, views = row[:5]
            key = f"{client}|{platform}"
            
            if key not in history:
                history[key] = {'followers': [], 'views': []}
            
            try:
                history[key]['followers'].append(int(followers))
                history[key]['views'].append(int(views))
            except (ValueError, TypeError):
                continue
        
        stats = {}
        for key, data in history.items():
            recent_followers = data['followers'][-10:]
            recent_views = data['views'][-10:]
            
            if not recent_followers:
                continue
            
            avg_followers = sum(recent_followers) / len(recent_followers)
            avg_views = sum(recent_views) / len(recent_views)
            
            stats[key] = {
                'avg_followers': avg_followers,
                'avg_views': avg_views,
                'count': len(recent_followers)
            }
        
        return stats
        
    except Exception as e:
        print(f"⚠️  Could not fetch historical data: {e}")
        return {}


def append_to_sheet(service, data):
    """Append new rows to Google Sheets"""
    rows = [[d['date'], d['client'], d['platform'], str(d['followers_gained']), str(d['views_gained'])] for d in data]
    
    body = {'values': rows}
    
    result = service.spreadsheets().values().append(
        spreadsheetId=SHEET_ID,
        range=RANGE_NAME,
        valueInputOption='RAW',
        insertDataOption='INSERT_ROWS',
        body=body
    ).execute()
    
    return result


def fetch_page(url):
    """Fetch page with headers"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.text


def safe_int(val):
    """Safely convert value to int"""
    if val is None:
        return 0
    if isinstance(val, str):
        val = val.replace(',', '')
        try:
            return int(val)
        except ValueError:
            return 0
    return int(val)


def check_anomaly_smart(followers_gained, views_gained, client_name, platform, historical):
    """Smart anomaly detection"""
    reasons = []
    key = f"{client_name}|{platform}"
    hist = historical.get(key, {})
    
    if followers_gained > FOLLOWER_THRESHOLD:
        if platform in ["YouTube", "TikTok"]:
            expected_min_views = followers_gained * VIEW_FOLLOWER_RATIO_MIN
            if views_gained < expected_min_views:
                reasons.append(
                    f"+{followers_gained:,} followers but only +{views_gained:,} views "
                    f"(expected ≥{expected_min_views:,})"
                )
        
        if platform == "Instagram" and followers_gained > 400:
            if hist.get('count', 0) >= MIN_HISTORY_COUNT:
                avg_followers = hist.get('avg_followers', 0)
                if avg_followers > 5 and followers_gained > avg_followers * 5:
                    reasons.append(
                        f"Instagram: +{followers_gained:,} followers (5x the avg of {avg_followers:.0f})"
                    )
            else:
                reasons.append(
                    f"Instagram: +{followers_gained:,} followers in one day (needs verification)"
                )
    
    if hist.get('count', 0) >= MIN_HISTORY_COUNT:
        avg_followers = hist['avg_followers']
        multiplier = HISTORICAL_MULTIPLIER if platform != "Instagram" else 5
        
        if avg_followers > 5 and followers_gained > avg_followers * multiplier:
            reasons.append(
                f"followers {followers_gained:,} is {followers_gained/avg_followers:.1f}x "
                f"the 10-day avg ({avg_followers:.0f})"
            )
    
    if followers_gained < -200:
        reasons.append(f"large follower loss: {followers_gained:,}")
    
    if views_gained < -10000:
        reasons.append(f"large negative views: {views_gained:,}")
    
    return reasons


def parse_socialblade_page(html, platform):
    """Extract stats from SocialBlade page"""
    soup = BeautifulSoup(html, 'html.parser')
    
    if "new to our database" in html.lower() or "check back tomorrow" in html.lower():
        return None
    
    script_tag = soup.find('script', id='__NEXT_DATA__')
    if not script_tag:
        return None
    
    try:
        data = json.loads(script_tag.string)
        queries = data['props']['pageProps']['trpcState']['json']['queries']
        
        history_data = None
        for query in queries:
            if 'history' in query['queryKey'][0]:
                history_data = query['state']['data']
                break
        
        if not history_data or len(history_data) < 2:
            return None
        
        today = history_data[-1]
        yesterday = history_data[-2]
        
        if platform == "YouTube":
            followers_today = safe_int(today.get('subscribers', 0))
            followers_yesterday = safe_int(yesterday.get('subscribers', 0))
        else:
            followers_today = safe_int(today.get('followers', 0))
            followers_yesterday = safe_int(yesterday.get('followers', 0))
        
        views_today = safe_int(today.get('views', 0))
        views_yesterday = safe_int(yesterday.get('views', 0))
        
        return {
            'followers': followers_today,
            'followers_gained': followers_today - followers_yesterday,
            'views_gained': views_today - views_yesterday,
        }
    except (json.JSONDecodeError, KeyError, IndexError, TypeError):
        return None


def main():
    today = datetime.now().strftime('%Y-%m-%d')
    
    print(f"🔄 Scraping {len(CLIENTS)} client-platform combinations")
    print(f"📅 Date: {today}")
    print(f"📊 Fetching historical data...\n")
    
    # Initialize Google Sheets
    service = get_sheets_service()
    historical = fetch_historical_data(service)
    print(f"   ✓ Loaded history for {len(historical)} client-platform pairs\n")
    
    results = []
    skipped = []
    anomalies = []
    
    for i, client in enumerate(CLIENTS, 1):
        print(f"[{i}/{len(CLIENTS)}] {client['name']} ({client['platform']})...", end=' ', flush=True)
        
        try:
            html = fetch_page(client['url'])
            stats = parse_socialblade_page(html, client['platform'])
            time.sleep(0.5)
            
            if not stats:
                print("⏭️  No data")
                skipped.append(f"{client['name']} ({client['platform']})")
                continue
            
            anomaly_reasons = check_anomaly_smart(
                stats['followers_gained'], 
                stats['views_gained'],
                client['name'],
                client['platform'],
                historical
            )
            
            if anomaly_reasons:
                reason_str = '; '.join(anomaly_reasons)
                print(f"⚠️  ANOMALY: {reason_str}")
                anomalies.append({
                    'client': client['name'],
                    'platform': client['platform'],
                    'followers': stats['followers_gained'],
                    'views': stats['views_gained'],
                    'reasons': reason_str
                })
                continue
            
            results.append({
                'date': today,
                'client': client['name'],
                'platform': client['platform'],
                'followers_gained': stats['followers_gained'],
                'views_gained': stats['views_gained']
            })
            
            print(f"✓ +{stats['followers_gained']} followers, +{stats['views_gained']:,} views")
            
        except requests.exceptions.Timeout:
            print("⏱️  Timeout")
            skipped.append(f"{client['name']} ({client['platform']}) - timeout")
        except Exception as e:
            print(f"✗ {e}")
            skipped.append(f"{client['name']} ({client['platform']}) - {str(e)[:50]}")
    
    if results:
        print(f"\n✅ Valid entries: {len(results)} | Updating Google Sheet...")
        append_to_sheet(service, results)
        print("✅ Sheet updated successfully")
    else:
        print("\n⚠️  No valid data to record")
    
    print(f"\n{'='*60}")
    print(f"📋 SCRAPE SUMMARY — {today}")
    print(f"{'='*60}")
    print(f"✅ Recorded: {len(results)}")
    print(f"⏭️  Skipped: {len(skipped)}")
    print(f"⚠️  Anomalies detected: {len(anomalies)}")
    
    if anomalies:
        print(f"\n⚠️  ANOMALIES (flagged, not recorded):")
        for a in anomalies:
            print(f"   • {a['client']} ({a['platform']}): {a['reasons']}")
    
    return 0


if __name__ == '__main__':
    exit(main())
