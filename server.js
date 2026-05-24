/**
 * FixItFund — Anthropic API Proxy Server
 * 
 * Keeps your API key server-side so it's never exposed in the browser.
 * Handles CORS, rate limiting, request validation, and error logging.
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const fetch      = require('node-fetch');
const path       = require('path');

const app  = express();
app.set('trust proxy', 1);
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// ─── Validate env on startup ────────────────────────────────────────────────
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('❌  ANTHROPIC_API_KEY is missing from .env — server cannot start.');
  process.exit(1);
}

// ─── Middleware ──────────────────────────────────────────────────────────────

// Parse JSON bodies (max 50kb — enough for chat history, not file uploads)
app.use(express.json({ limit: '50kb' }));

// CORS — restrict to your actual domain in production
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman) in development
    if (!origin || process.env.NODE_ENV !== 'production') return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin "${origin}" not allowed`));
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

// Rate limiting — 30 AI requests per IP per minute (adjust as needed)
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,          // 1 minute
  max: parseInt(process.env.RATE_LIMIT_PER_MIN || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests. Please wait a moment before asking another question.',
    code: 'RATE_LIMITED',
  },
});

// ─── Serve the static website ─────────────────────────────────────────────
// Place your fixer_upper_reno_leads.html (and any assets) in a /public folder
app.use(express.static(path.join(__dirname, 'public')));

// ─── AI Proxy Endpoint ────────────────────────────────────────────────────
app.post('/api/chat', aiLimiter, async (req, res) => {
  const { messages, system } = req.body;

  // ── Input validation ──────────────────────────────────────────────────────
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'Request must include a non-empty "messages" array.',
      code: 'INVALID_REQUEST',
    });
  }

  // Cap conversation history to last 20 turns to control token usage
  const MAX_TURNS = 20;
  const trimmedMessages = messages.slice(-MAX_TURNS);

  // Validate each message has required shape
  for (const msg of trimmedMessages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return res.status(400).json({
        error: 'Each message must have a "role" (user/assistant) and "content" (string).',
        code: 'INVALID_MESSAGE',
      });
    }
    if (!['user', 'assistant'].includes(msg.role)) {
      return res.status(400).json({
        error: `Invalid role "${msg.role}". Must be "user" or "assistant".`,
        code: 'INVALID_ROLE',
      });
    }
  }

  // ── Call Anthropic API ────────────────────────────────────────────────────
  try {
    const payload = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: trimmedMessages,
    };

    // Use system prompt from client if provided, otherwise use default
    if (system && typeof system === 'string') {
      payload.system = system;
    } else {
      payload.system = DEFAULT_SYSTEM_PROMPT;
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            process.env.ANTHROPIC_API_KEY,
        'anthropic-version':    '2023-06-01',
      },
      body: JSON.stringify(payload),
    });

    // Forward non-200 responses from Anthropic with safe error messages
    if (!anthropicRes.ok) {
      const errorBody = await anthropicRes.json().catch(() => ({}));
      console.error(`[Anthropic API Error] ${anthropicRes.status}:`, errorBody);

      // Don't leak internal Anthropic error details to the browser
      const userMessage = anthropicRes.status === 529
        ? 'The AI is overloaded right now. Please try again in a moment.'
        : anthropicRes.status === 401
        ? 'API configuration error. Please contact support.'
        : 'The AI advisor is temporarily unavailable. Please try again shortly.';

      return res.status(502).json({ error: userMessage, code: 'UPSTREAM_ERROR' });
    }

    const data = await anthropicRes.json();

    // Extract text from the response content array
    const replyText = data.content
      ?.filter(block => block.type === 'text')
      .map(block => block.text)
      .join('') || '';

    if (!replyText) {
      return res.status(502).json({
        error: 'Received an empty response from the AI. Please try again.',
        code: 'EMPTY_RESPONSE',
      });
    }

    // Return just what the frontend needs
    return res.json({
      reply: replyText,
      usage: {
        input_tokens:  data.usage?.input_tokens  || 0,
        output_tokens: data.usage?.output_tokens || 0,
      },
    });

  } catch (err) {
    console.error('[Proxy Server Error]', err.message);
    return res.status(500).json({
      error: 'An unexpected error occurred. Please try again.',
      code: 'SERVER_ERROR',
    });
  }
});
// ─── Blog Posts ───────────────────────────────────────────────────────────────
const POSTS_FILE = path.join(__dirname, 'posts.json');
const ADMIN_KEY  = process.env.ADMIN_KEY || 'FixerUpper2026!';
const fs = require('fs');

function readPosts(){
  try{ if(fs.existsSync(POSTS_FILE)) return JSON.parse(fs.readFileSync(POSTS_FILE,'utf8')); }
  catch(e){}
  return [];
}
function writePosts(p){ try{ fs.writeFileSync(POSTS_FILE,JSON.stringify(p,null,2)); return true; }catch(e){ return false; } }

app.get('/api/posts', (req,res) => {
  const posts = readPosts().filter(p=>p.status==='published').sort((a,b)=>new Date(b.publishedAt)-new Date(a.publishedAt));
  res.json({posts});
});
app.get('/api/posts/all', (req,res) => {
  if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'Unauthorized'});
  res.json({posts: readPosts().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))});
});
app.post('/api/posts', (req,res) => {
  if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'Unauthorized'});
  const post = req.body;
  if(!post||!post.id||!post.title) return res.status(400).json({error:'Post needs id and title'});
  const posts = readPosts();
  const idx = posts.findIndex(p=>p.id===post.id);
  if(idx>=0) posts[idx]=post; else posts.unshift(post);
  writePosts(posts) ? res.json({success:true,post}) : res.status(500).json({error:'Save failed'});
});
app.delete('/api/posts/:id', (req,res) => {
  if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'Unauthorized'});
  const posts = readPosts().filter(p=>String(p.id)!==String(req.params.id));
  writePosts(posts) ? res.json({success:true}) : res.status(500).json({error:'Delete failed'});
});
app.patch('/api/posts/:id', (req,res) => {
  if(req.headers['x-admin-key']!==ADMIN_KEY) return res.status(401).json({error:'Unauthorized'});
  const posts = readPosts();
  const post = posts.find(p=>String(p.id)===String(req.params.id));
  if(!post) return res.status(404).json({error:'Not found'});
  post.status = req.body.status||(post.status==='published'?'draft':'published');
  if(post.status==='published'&&!post.publishedAt) post.publishedAt=new Date().toISOString();
  writePosts(posts) ? res.json({success:true,post}) : res.status(500).json({error:'Update failed'});
});
// ─── Health check endpoint ────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:  'ok',
    service: 'FixItFund AI Proxy',
    time:    new Date().toISOString(),
  });
});

// ─── 404 fallback (serve index for SPA-style routing) ────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start server ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅  FixItFund proxy running on http://localhost:${PORT}`);
  console.log(`    Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`    Rate limit: ${process.env.RATE_LIMIT_PER_MIN || 30} requests/min/IP`);
  console.log(`    Environment: ${process.env.NODE_ENV || 'development'}`);
});

// ─── Default system prompt (fallback if client doesn't send one) ──────────
const DEFAULT_SYSTEM_PROMPT = `You are a friendly, knowledgeable renovation mortgage advisor for FixItFund.
You specialize in FHA 203(k), Fannie Mae HomeStyle, Freddie Mac CHOICERenovation,
VA Renovation, and USDA Renovation loans. Help users figure out which loan fits their
situation. Keep responses concise (2-4 paragraphs), conversational, and always end
with a gentle nudge to use the calculator or get pre-approved. Never guarantee
specific rates or make lending commitments.`;
