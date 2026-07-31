// tracelayer.com waitlist API — zero-dependency Node service.
// Runs under pm2 as `tracelayer-waitlist`, fronted by Caddy at api.tracelayer.com.
// Storage: single JSON file with atomic tmp+rename writes — plenty for a waitlist.
import http from 'node:http'
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'

const PORT = 4890
const DIR = '/var/lib/tracelayer-waitlist'
const FILE = DIR + '/waitlist.json'

mkdirSync(DIR, { recursive: true })
let db = { seq: 0, rows: {} } // rows keyed by email: {n, ref, referrals, referredBy?, at}
if (existsSync(FILE)) {
  try { db = JSON.parse(readFileSync(FILE, 'utf8')) } catch { /* keep fresh db */ }
}

let saveT = null
function save() {
  clearTimeout(saveT)
  saveT = setTimeout(() => {
    const tmp = FILE + '.tmp'
    writeFileSync(tmp, JSON.stringify(db))
    renameSync(tmp, FILE)
  }, 150)
}

function refOwner(ref) {
  for (const [email, row] of Object.entries(db.rows)) if (row.ref === ref) return email
  return null
}

// A referral moves you up 10 places: rank by join order minus 10 per signup you brought in.
const score = row => row.n - 10 * (row.referrals || 0)
function position(email) {
  const me = db.rows[email], s = score(me)
  let ahead = 0
  for (const [e, r] of Object.entries(db.rows)) {
    if (e === email) continue
    const t = score(r)
    if (t < s || (t === s && r.n < me.n)) ahead++
  }
  return ahead
}

const hits = new Map()
function limited(ip) {
  const now = Date.now()
  const arr = (hits.get(ip) || []).filter(t => now - t < 60_000)
  arr.push(now)
  hits.set(ip, arr)
  if (hits.size > 5000) hits.clear()
  return arr.length > 20
}

const ALLOW = ['https://tracelayer.com', 'https://www.tracelayer.com']

http.createServer((req, res) => {
  const origin = req.headers.origin || ''
  const h = {
    'Access-Control-Allow-Origin': ALLOW.includes(origin) ? origin : ALLOW[0],
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  }
  if (req.method === 'OPTIONS') { res.writeHead(204, h); res.end(); return }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, h); res.end(JSON.stringify({ ok: true, joined: db.seq })); return
  }
  if (req.method === 'POST' && req.url === '/waitlist') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim()
    if (limited(ip)) { res.writeHead(429, h); res.end('{"error":"slow down"}'); return }
    let body = ''
    req.on('data', c => { body += c; if (body.length > 2000) req.destroy() })
    req.on('end', () => {
      try {
        const j = JSON.parse(body || '{}')
        const email = String(j.email || '').trim().toLowerCase()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
          res.writeHead(400, h); res.end('{"error":"invalid email"}'); return
        }
        let row = db.rows[email]
        if (!row) {
          db.seq += 1
          row = { n: db.seq, ref: Math.random().toString(36).slice(2, 8), referrals: 0, at: new Date().toISOString() }
          const rref = typeof j.ref === 'string' ? j.ref.slice(0, 12) : null
          if (rref) {
            const owner = refOwner(rref)
            if (owner && owner !== email) {
              db.rows[owner].referrals = (db.rows[owner].referrals || 0) + 1
              row.referredBy = rref
            }
          }
          db.rows[email] = row
          save()
        }
        res.writeHead(200, h)
        res.end(JSON.stringify({ number: row.n, ahead: position(email), ref: row.ref }))
      } catch {
        res.writeHead(400, h); res.end('{"error":"bad request"}')
      }
    })
    return
  }
  res.writeHead(404, h); res.end('{"error":"not found"}')
}).listen(PORT, '127.0.0.1', () => console.log('tracelayer waitlist listening on ' + PORT))
