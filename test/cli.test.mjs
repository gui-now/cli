// Runs the built CLI (dist/index.js) against a local fake GUI API.
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../dist/index.js', import.meta.url))

let server
let base
let requests = []
let respond = () => ({ status: 200, body: {} })

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : undefined })
      const { status, body, headers = {} } = respond(req)
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
      res.end(JSON.stringify(body))
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})

after(() => server.close())

beforeEach(() => {
  requests = []
})

function run(args, { input, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      env: { PATH: process.env.PATH, GUI_NOW_BASE_URL: base, ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c))
    child.stderr.on('data', (c) => (stderr += c))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input ?? '')
  })
}

test('push prints only the URL on stdout and the claim link on stderr', async () => {
  respond = () => ({
    status: 201,
    body: {
      id: 'abc',
      url: `${base}/abc`,
      edit_token: 'tok',
      expires_at: '2026-11-04T12:00:00.000Z',
      claim_url: `${base}/claim/abc#token=xyz`,
    },
  })
  const r = await run(['push', '--title', 'Hi'], { input: '<h1>hi</h1>' })
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.stdout, `${base}/abc\n`)
  assert.match(r.stderr, /expires 2026-11-04T12:00:00.000Z/)
  assert.match(r.stderr, new RegExp(`open ${base}/claim/abc#token=xyz`))
  assert.doesNotMatch(r.stdout + r.stderr, /tok\b/, 'edit token is only shown with --json')

  const [req] = requests
  assert.equal(req.method, 'POST')
  assert.equal(req.url, '/api/canvas')
  assert.equal(req.headers['x-gui-client'], 'gui-now')
  assert.deepEqual(req.body, { html: '<h1>hi</h1>', title: 'Hi' })
})

test('push sends expires and agent, and says when expiry never ends or was capped', async () => {
  respond = () => ({
    status: 201,
    body: { id: 'p', url: `${base}/p`, edit_token: 't', expires_at: null, expires_clamped: true },
  })
  const r = await run(['push', '-e', 'never', '-a', 'Claude Code', '-m'], {
    input: '# hi',
    env: { GUI_NOW_API_KEY: 'gui_key' },
  })
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stderr, /never expires/)
  assert.match(r.stderr, /capped/)
  assert.doesNotMatch(r.stderr, /claim/)
  const [req] = requests
  assert.equal(req.headers['x-api-key'], 'gui_key')
  assert.deepEqual(req.body, { markdown: '# hi', expires: 'never', agent: 'Claude Code' })
})

test('GUI_NOW_AGENT is the default agent and --json prints the full response', async () => {
  const body = { id: 'j', url: `${base}/j`, edit_token: 't', expires_at: null, claim_url: `${base}/claim/j#token=q` }
  respond = () => ({ status: 201, body })
  const r = await run(['push', '--json'], { input: '<p>x</p>', env: { GUI_NOW_AGENT: 'Codex' } })
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), body)
  assert.equal(requests[0].body.agent, 'Codex')
})

test('push reports an API error and exits 1', async () => {
  respond = () => ({ status: 400, body: { error: 'expires must be a duration like "1h"' } })
  const r = await run(['push', '-e', 'soon'], { input: '<p>x</p>' })
  assert.equal(r.code, 1)
  assert.match(r.stderr, /Error: expires must be a duration/)
})

test('push reports a rate limit with Retry-After', async () => {
  respond = () => ({ status: 429, body: { error: 'nope' }, headers: { 'Retry-After': '120' } })
  const r = await run(['push'], { input: '<p>x</p>' })
  assert.equal(r.code, 1)
  assert.match(r.stderr, /Rate limited. Try again in 120 seconds/)
})

test('extend without a token sends no body and no Authorization', async () => {
  respond = () => ({ status: 200, body: { id: 'abc', expires_at: '2026-11-05T00:00:00.000Z', extended: true } })
  const r = await run(['extend', 'abc'])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.stdout, 'expires 2026-11-05T00:00:00.000Z\n')
  const [req] = requests
  assert.equal(req.method, 'POST')
  assert.equal(req.url, '/api/canvas/abc/extend')
  assert.equal(req.headers.authorization, undefined)
  assert.equal(req.body, undefined)
})

test('extend with --token and --expires sends both', async () => {
  respond = () => ({ status: 200, body: { id: 'abc', expires_at: null, extended: true } })
  const r = await run(['extend', 'abc', '--token', 'edit-123', '--expires', 'never'])
  assert.equal(r.code, 0, r.stderr)
  assert.equal(r.stdout, 'never expires\n')
  const [req] = requests
  assert.equal(req.headers.authorization, 'Bearer edit-123')
  assert.deepEqual(req.body, { expires: 'never' })
})

test('extend --expires without --token fails before calling the API', async () => {
  const r = await run(['extend', 'abc', '--expires', '7d'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /--expires needs --token/)
  assert.equal(requests.length, 0)
})

test('extend past the ceiling shows the latest possible expiry', async () => {
  respond = () => ({
    status: 409,
    body: { error: 'Canvas is at its maximum expiry', max_expires_at: '2026-11-06T08:00:00.000Z' },
  })
  const r = await run(['extend', 'abc'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /maximum expiry/)
  assert.match(r.stderr, /past 2026-11-06T08:00:00.000Z/)
})

test('extend escapes the canvas id in the path', async () => {
  respond = () => ({ status: 404, body: { error: 'Canvas not found' } })
  const r = await run(['extend', '../x?y'])
  assert.equal(r.code, 1)
  assert.equal(requests[0].url, '/api/canvas/..%2Fx%3Fy/extend')
  assert.match(r.stderr, /Canvas not found/)
})

test('extend needs an id', async () => {
  const r = await run(['extend'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /requires a canvas ID/)
  assert.equal(requests.length, 0)
})

test('help lists extend and the v2 expiry options', async () => {
  const r = await run(['help'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /gui extend <id>/)
  assert.match(r.stdout, /never/)
  assert.match(r.stdout, /GUI_NOW_BASE_URL/)
})
