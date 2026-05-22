# FixItFund — AI Proxy Server

A lightweight Node.js/Express proxy that sits between your website and the
Anthropic API. Your secret API key lives only on the server — never in the browser.

---

## What It Does

- Receives chat messages from the FixItFund frontend
- Forwards them to Anthropic's API using your secret key
- Returns the AI reply to the browser
- Enforces rate limiting, CORS, and input validation

---

## Project Structure

```
fixitfund-proxy/
├── server.js          ← The proxy server
├── package.json
├── .env.example       ← Copy to .env and fill in your values
├── .gitignore
├── README.md
└── public/            ← Put your website files here
    └── index.html     ← Rename fixer_upper_reno_leads.html → index.html
```

---

## Quick Start (Local Development)

### 1. Install Node.js
Download from https://nodejs.org — version 18 or higher required.

### 2. Install dependencies
```bash
cd fixitfund-proxy
npm install
```

### 3. Create your .env file
```bash
cp .env.example .env
```
Open `.env` and paste in your Anthropic API key:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```
Get your key at: https://console.anthropic.com/settings/keys

### 4. Add your website files
Create a `public/` folder and copy `fixer_upper_reno_leads.html` into it,
renaming it to `index.html`.

### 5. Update the frontend to use the proxy
In `index.html`, find the `fetch` call inside the `sendAI()` function and
change:
```javascript
// BEFORE (calls Anthropic directly — exposes your key)
const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: '...', ... })
});
const data = await res.json();
const reply = data.content[0].text;
```
```javascript
// AFTER (calls your proxy — key stays secret)
const res = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: aiHistory })
});
const data = await res.json();
const reply = data.reply;
```

### 6. Start the server
```bash
npm start
```
Visit http://localhost:3000 — you should see your website with the AI advisor
working.

For development with auto-restart on file changes:
```bash
npm run dev
```

---

## Deployment Options

### Option A — Railway (easiest, ~$5/mo)
1. Push this folder to a GitHub repo
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Add environment variables in the Railway dashboard (same as your .env)
4. Railway auto-detects Node.js and runs `npm start`
5. Your app gets a public URL like `https://fixitfund-proxy.up.railway.app`

### Option B — Render (free tier available)
1. Push to GitHub
2. Go to https://render.com → New → Web Service
3. Connect your repo, set Build Command: `npm install`, Start Command: `npm start`
4. Add environment variables in the Render dashboard
5. Free tier spins down after 15 min of inactivity (paid tier stays warm)

### Option C — DigitalOcean App Platform (~$5/mo)
1. Push to GitHub
2. Go to https://cloud.digitalocean.com/apps → Create App
3. Connect repo, select Node.js, set run command: `node server.js`
4. Add env vars, deploy

### Option D — VPS (most control)
On any Ubuntu/Debian server:
```bash
# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Clone your repo and install
git clone https://github.com/yourname/fixitfund-proxy.git
cd fixitfund-proxy
npm install --production

# Create .env
cp .env.example .env
nano .env   # paste your API key and set NODE_ENV=production

# Run with PM2 (keeps it running after logout)
sudo npm install -g pm2
pm2 start server.js --name fixitfund
pm2 save
pm2 startup

# (Optional) Put Nginx in front for HTTPS
sudo apt install nginx certbot python3-certbot-nginx
```

---

## Updating ALLOWED_ORIGINS for Production

Once your site is live at e.g. `https://www.fixitfund.com`, update your `.env`:
```
ALLOWED_ORIGINS=https://www.fixitfund.com,https://fixitfund.com
NODE_ENV=production
```
This blocks requests from any other domain — important so strangers can't
use your API key from their own sites.

---

## API Endpoints

| Method | Path         | Description                          |
|--------|-------------|--------------------------------------|
| POST   | /api/chat   | Send messages, get AI reply          |
| GET    | /api/health | Health check — returns `{"status":"ok"}` |

### POST /api/chat — Request body
```json
{
  "messages": [
    { "role": "user",      "content": "Which loan is best for a veteran?" },
    { "role": "assistant", "content": "Great question! For veterans..." },
    { "role": "user",      "content": "What about the funding fee?" }
  ]
}
```

### POST /api/chat — Response
```json
{
  "reply": "The VA funding fee is 2.3% for first-time use...",
  "usage": { "input_tokens": 312, "output_tokens": 187 }
}
```

---

## Rate Limiting

Default: 30 requests per IP per minute. Adjust `RATE_LIMIT_PER_MIN` in `.env`.
If a user hits the limit, they receive:
```json
{ "error": "Too many requests. Please wait a moment before asking another question.", "code": "RATE_LIMITED" }
```

---

## Security Notes

- Your `ANTHROPIC_API_KEY` is never sent to the browser
- Set `ALLOWED_ORIGINS` to your exact domain(s) in production
- The server caps conversation history to the last 20 turns to limit token costs
- Request bodies are capped at 50kb to prevent abuse
- Never commit `.env` to git — it's in `.gitignore`

---

## Estimated Costs

At typical usage (30 AI chats/day, ~500 tokens each):
- ~15,000 input tokens/day + ~15,000 output tokens/day
- Claude Sonnet: ~$0.003/day → ~$1/month

Monitor your usage at https://console.anthropic.com/usage
