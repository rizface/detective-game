# Night Shift

A co-op detective game you play in the browser with up to six friends. The board is a whole city: you read
case files, travel to addresses, question people, look names up in the city directory, pin evidence to a
shared board, and when you think you know what happened, your agency files one report together.

It ships with one long case, **Ghost Lamps** (Port Calloway, October 1985): four chapters, about 4–6 hours
for a team that reads everything and argues about it.

> **No spoilers in this README.** The case content lives in `backend/cases/ghost-lamps.dgcase`, a sealed
> bundle that looks like noise if you open it. Don't run `casepack unseal` on it, and don't open it in the
> case editor (it will warn you), unless you've finished the case or don't mind knowing the ending.

## Play it

You need Docker.

```sh
docker compose up --build
```

Open <http://localhost:8080>, create an account (the first account on a fresh install is the admin),
pick **Ghost Lamps** and press **Take the case**. Use **Invite** in the top bar to copy a link for your
friends. Everyone sees the same city, the same evidence and the same clock, live.

To play with friends who aren't on your network, put it behind any HTTPS reverse proxy (Caddy, nginx,
Cloudflare Tunnel, ngrok…) and set `SECURE_COOKIES=true`.

### How to play

- **Travel.** Click a place on the map and press *Go there*. New places appear as you find them. If you read
  an address that isn't on your map, type it into **Directory → Go to an address**.
- **Talk.** When people are at the place you're in, press *Talk*. Ask them about people, places and some
  pieces of evidence. Asking the same thing twice is free; it replays the answer.
- **Look things up.** The city directory finds a listing when you type the surname or business name exactly as
  you read it.
- **Time counts.** Every trip, question and lookup moves the clock. Days end at 11 p.m. Your final score
  compares your time against a sharp agency's, so talk it over before you move.
- **Evidence board.** Pin documents, people, places and notes, and string them together. Teammates see cards
  move as you drag them.
- **Sound** is off until you turn it on with the speaker button in the top bar: rain and harbor in the
  background, a car door when you travel, a typewriter when evidence arrives, a piano chord for each new chapter.
  Everything is synthesized in the browser; there are no audio files. Each player's setting is saved in their own
  browser.
- **The report** opens in the last chapter. Every teammate who is online must sign it before it can be filed.
  You get three attempts, and after each you're only told how many of the key answers were right.

## Run it for development

You need Go 1.24+, Node 20+, PostgreSQL 14+ and Redis 6+.

```sh
# database
createuser detective -P            # password: detective
createdb -O detective detective

# server (http://localhost:8080)
cd backend
go run ./cmd/server

# client with hot reload (http://localhost:5173, proxies /api to :8080)
cd frontend
npm install
npm run dev
```

Environment variables (all optional):

| Variable | Default | |
|---|---|---|
| `ADDR` | `:8080` | Listen address |
| `DATABASE_URL` | `postgres://detective:detective@localhost:5432/detective?sslmode=disable` | |
| `REDIS_URL` | `redis://localhost:6379/0` | Sessions, presence and real-time fan-out |
| `STATIC_DIR` | *(empty)* | Serve the built client from this directory |
| `ADMIN_EMAILS` | *(empty)* | Comma-separated emails that get the case editor |
| `SECURE_COOKIES` | `false` | Set `true` behind HTTPS |

Tests: `cd backend && go test ./...`

## How it's built

```
backend/                 Go
  cmd/server             HTTP + WebSocket server
  cmd/casepack           case tool: validate, seal, unseal, play scripted paths
  cases/                 bundled sealed cases (installed into the database at startup)
  internal/casefmt       the case format, condition language, validator, sealing
  internal/game          the rules engine (pure: state in, outcome out) and playthrough simulator
  internal/server        accounts, teams, gameplay API, notes/board/chat, report, case editor API
  internal/db            pgx pool and embedded SQL migrations
frontend/                React + TypeScript + Vite
  src/game               the game screen: map, scenes, evidence, interviews, board, report
  src/admin              the case editor
  src/sound              synthesized sound effects and ambience (Web Audio)
docs/                    authoring guide and an example case
```

- **Server-authoritative.** The client only ever receives what the team has found. The full case never
  leaves the server, and answers are stored as salted hashes, so the network tab spoils nothing.
- **Concurrency.** Every game action runs in a transaction that locks the team's row, so two teammates
  clicking at once apply one after the other.
- **Real time.** Changes are published on Redis channel `team:<id>`; every server instance subscribes to
  `team:*` and forwards to its own WebSocket clients, so you can run several instances behind a load balancer.
  Presence is a Redis sorted set of heartbeats. Board drags and "who's reading what" are relayed, not stored.
- **Sessions** are opaque tokens in Redis, in an HttpOnly cookie. Passwords are bcrypt. Login is rate-limited.

## Writing your own cases

Sign in as an admin and open **Case editor** in the top bar, or write YAML by hand. See
[docs/AUTHORING.md](docs/AUTHORING.md) for the format, and [docs/examples/missing-cat.yaml](docs/examples/missing-cat.yaml)
for a small complete case.

The editor's **Check** button and `casepack validate` both run a playthrough simulation. It reports broken
references, places and documents nobody can ever reach, chapters that never start, and solution evidence
that can't be found, plus a rough play-time estimate.

```sh
cd backend
go run ./cmd/casepack validate ../docs/examples/missing-cat.yaml
go run ./cmd/casepack play ../docs/examples/missing-cat.yaml ../docs/examples/missing-cat.play
go run ./cmd/casepack seal my-case.yaml cases/my-case.dgcase   # bundle it with the server
```
