module github.com/rizface/detective-game/backend

// The replace directives point golang.org/x and gopkg.in modules at their official GitHub
// mirrors; the machine this was built on could not reach proxy.golang.org. They are harmless.
// To drop them: delete the replace lines and run `go mod tidy`.

go 1.24

replace golang.org/x/crypto => github.com/golang/crypto v0.31.0

replace golang.org/x/text => github.com/golang/text v0.21.0

replace golang.org/x/sync => github.com/golang/sync v0.10.0

replace gopkg.in/yaml.v3 => github.com/go-yaml/yaml v0.0.0-20220527083530-f6f7691b1fde

replace golang.org/x/sys => github.com/golang/sys v0.28.0

replace golang.org/x/net => github.com/golang/net v0.33.0

replace gopkg.in/check.v1 => github.com/go-check/check v0.0.0-20161208181325-20d25e280405

require (
	github.com/coder/websocket v1.8.12
	github.com/go-chi/chi/v5 v5.2.1
	github.com/jackc/pgx/v5 v5.7.2
	github.com/redis/go-redis/v9 v9.7.3
	golang.org/x/crypto v0.31.0
	gopkg.in/yaml.v3 v3.0.1
)

require (
	github.com/cespare/xxhash/v2 v2.2.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	golang.org/x/sync v0.10.0 // indirect
	golang.org/x/text v0.21.0 // indirect
)
