require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');
const fetch     = require('node-fetch');
const path      = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is missing');
  process.exit(1);
}

app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || process.env.NODE_ENV !== 'production') return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed'));
  },
  methods: ['GET', 'POST', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-admin-key'],
}));

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_PER_MIN || '30'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.' },
});

app.use(express.static(path.join(__dirname, 'public')));

// Supabase config
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const ADMIN_KEY    = process.env.ADMIN_KEY || 'FixerUpper2026!';

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Prefer': 'return=representation'
  };
}

async function sbGet(filter) {
  const url = SUPABASE_URL + '/rest/v1/Post?' + (filter || '') + '&order=published_at.desc.nullslast';
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) throw new Error('Supabase GET failed: ' + res.status);
  const rows = await res.json(); return rows.map(function(r){return {id:r.id,title:r.title,slug:r.slug,content:r.content,category:r.category,seoTitle:r.seo_title,metaDescription:r.meta_description,readTime:r.read_time,state:r.state,status:r.status,createdAt:r.created_at,publishedAt:r.published_at,excerpt:r.content?r.content.split(String.fromCharCode(10)).filter(function(l){return l.trim()&&l.indexOf("##")!==0;}).join(" ").substring(0,160)+"...":""};});
}

async function sbUpsert(post) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/Post', {
    method: 'POST',
    headers: Object.assign({}, sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify({id:post.id,title:post.title,slug:post.slug,content:post.content,category:post.category,seo_title:post.seoTitle,meta_description:post.metaDescription,read_time:post.readTime,state:post.state,status:post.status,created_at:post.createdAt,published_at:post.publishedAt||null})
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error('Supabase upsert failed: ' + err);
  }
  const rows = await res.json(); return rows.map(function(r){return {id:r.id,title:r.title,slug:r.slug,content:r.content,category:r.category,seoTitle:r.seo_title,metaDescription:r.meta_description,readTime:r.read_time,state:r.state,status:r.status,createdAt:r.created_at,publishedAt:r.published_at,excerpt:r.content?r.content.split(String.fromCharCode(10)).filter(function(l){return l.trim()&&l.indexOf("##")!==0;}).join(" ").substring(0,160)+"...":""};});
}

async function sbPatch(id, data) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/Post?id=eq.' + id, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Supabase PATCH failed: ' + res.status);
  const rows = await res.json(); return rows.map(function(r){return {id:r.id,title:r.title,slug:r.slug,content:r.content,category:r.category,seoTitle:r.seo_title,metaDescription:r.meta_description,readTime:r.read_time,state:r.state,status:r.status,createdAt:r.created_at,publishedAt:r.published_at,excerpt:r.content?r.content.split(String.fromCharCode(10)).filter(function(l){return l.trim()&&l.indexOf("##")!==0;}).join(" ").substring(0,160)+"...":""};});
}

async function sbDelete(id) {
  const res = await fetch(SUPABASE_URL + '/rest/v1/Post?id=eq.' + id, {
    method: 'DELETE',
    headers: sbHeaders()
  });
  if (!res.ok) throw new Error('Supabase DELETE failed: ' + res.status);
  return true;
}

// GET published posts (public)
app.get('/api/posts', async (req, res) => {
  try {
    const posts = await sbGet('status=eq.published');
    res.json({ posts: posts });
  } catch(e) {
    console.error('GET /api/posts error:', e.message);
    res.json({ posts: [] });
  }
});

// GET all posts (admin)
app.get('/api/posts/all', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const posts = await sbGet('');
    res.json({ posts: posts });
  } catch(e) {
    console.error('GET /api/posts/all error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST save/update post (admin)
app.post('/api/posts', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  const post = req.body;
  if (!post || !post.id || !post.title) return res.status(400).json({ error: 'Post needs id and title' });
  try {
    const result = await sbUpsert(post);
    res.json({ success: true, post: result[0] || post });
  } catch(e) {
    console.error('POST /api/posts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// DELETE post (admin)
app.delete('/api/posts/:id', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await sbDelete(req.params.id);
    res.json({ success: true });
  } catch(e) {
    console.error('DELETE /api/posts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PATCH toggle status (admin)
app.patch('/api/posts/:id', async (req, res) => {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const posts = await sbGet('id=eq.' + req.params.id);
    const post = posts[0];
    if (!post) return res.status(404).json({ error: 'Not found' });
    const newStatus = req.body.status || (post.status === 'published' ? 'draft' : 'published');
    const updated = await sbPatch(req.params.id, {
      status: newStatus,
      published_at: newStatus === 'published' && !post.published_at ? new Date().toISOString() : post.published_at
    });
    res.json({ success: true, post: updated[0] || post });
  } catch(e) {
    console.error('PATCH /api/posts error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// AI Chat Proxy
app.post('/api/chat', aiLimiter, async (req, res) => {
  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Request must include a non-empty messages array.' });
  }
  const trimmedMessages = messages.slice(-20);
  for (const msg of trimmedMessages) {
    if (!msg.role || !msg.content || typeof msg.content !== 'string') {
      return res.status(400).json({ error: 'Each message must have role and content.' });
    }
    if (!['user', 'assistant'].includes(msg.role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
  }
  try {
    const requestedTokens = req.body.max_tokens;
    const payload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: (requestedTokens && requestedTokens <= 2000) ? requestedTokens : 1500,
      messages: trimmedMessages,
      system: (system && typeof system === 'string') ? system : DEFAULT_SYSTEM_PROMPT,
    };
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
    });
    if (!anthropicRes.ok) {
      const errorBody = await anthropicRes.json().catch(() => ({}));
      console.error('Anthropic API Error:', anthropicRes.status, errorBody);
      return res.status(502).json({ error: 'AI temporarily unavailable. Please try again.' });
    }
    const data = await anthropicRes.json();
    const replyText = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
    if (!replyText) return res.status(502).json({ error: 'Empty response from AI.' });
    return res.json({ reply: replyText, usage: data.usage });
  } catch (err) {
    console.error('Proxy error:', err.message);
    return res.status(500).json({ error: 'Unexpected error. Please try again.' });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', service: 'FixerUpperFinds', time: new Date().toISOString() });
});

// 404 fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log('FixItFund proxy running on http://localhost:' + PORT);
  console.log('Supabase URL:', SUPABASE_URL ? 'configured' : 'MISSING');
});

const DEFAULT_SYSTEM_PROMPT = 'You are a friendly home search advisor for FixerUpperFinds.com specializing in fixer-upper and undervalued homes in MD, DC, VA, and WV. Help users find and evaluate below-market properties and understand renovation financing options. Keep responses concise and helpful.';
 
