package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"strings"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rizface/detective-game/backend/internal/casefmt"
	"github.com/rizface/detective-game/backend/internal/game"
)

// registry caches one engine per case, keyed by id and invalidated by version.
type registry struct {
	pool *pgxpool.Pool
	mu   sync.Mutex
	byID map[string]cachedCase
}

type cachedCase struct {
	version int
	engine  *game.Engine
}

func newRegistry(pool *pgxpool.Pool) *registry {
	return &registry{pool: pool, byID: map[string]cachedCase{}}
}

var errNoCase = errors.New("case not found")

// engine returns the engine for a case, loading it if the cached version is stale.
func (r *registry) engine(ctx context.Context, caseID string) (*game.Engine, error) {
	var version int
	if err := r.pool.QueryRow(ctx, `SELECT version FROM cases WHERE id = $1`, caseID).Scan(&version); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errNoCase
		}
		return nil, err
	}
	r.mu.Lock()
	cached, ok := r.byID[caseID]
	r.mu.Unlock()
	if ok && cached.version == version {
		return cached.engine, nil
	}
	var raw []byte
	if err := r.pool.QueryRow(ctx, `SELECT content, version FROM cases WHERE id = $1`, caseID).Scan(&raw, &version); err != nil {
		return nil, err
	}
	var c casefmt.Case
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, fmt.Errorf("decode case %s: %w", caseID, err)
	}
	e := game.NewEngine(&c)
	r.mu.Lock()
	r.byID[caseID] = cachedCase{version: version, engine: e}
	r.mu.Unlock()
	return e, nil
}

// syncBundles installs or upgrades the cases shipped with the server.
// A bundled case that an admin has since edited (sealed = false) is left alone.
func syncBundles(ctx context.Context, pool *pgxpool.Pool, bundles fs.FS) error {
	names, err := fs.Glob(bundles, "*.dgcase")
	if err != nil {
		return err
	}
	for _, name := range names {
		data, err := fs.ReadFile(bundles, name)
		if err != nil {
			return err
		}
		c, err := casefmt.Load(data)
		if err != nil {
			return fmt.Errorf("bundle %s: %w", name, err)
		}
		casefmt.HashAnswers(c)
		if c.Version == 0 {
			c.Version = 1
		}
		raw, err := json.Marshal(c)
		if err != nil {
			return err
		}
		var (
			existing bool
			sealed   bool
			version  int
		)
		err = pool.QueryRow(ctx, `SELECT true, sealed, version FROM cases WHERE slug = $1`, c.Slug).Scan(&existing, &sealed, &version)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		switch {
		case !existing:
			_, err = pool.Exec(ctx, `INSERT INTO cases (slug, title, content, sealed, published, version) VALUES ($1, $2, $3, true, true, $4)`,
				c.Slug, c.Title, raw, c.Version)
			slog.Info("installed bundled case", "slug", c.Slug, "version", c.Version)
		case sealed && version < c.Version:
			_, err = pool.Exec(ctx, `UPDATE cases SET title = $2, content = $3, version = $4, updated_at = now() WHERE slug = $1`,
				c.Slug, c.Title, raw, c.Version)
			slog.Info("upgraded bundled case", "slug", c.Slug, "from", version, "to", c.Version)
		}
		if err != nil {
			return fmt.Errorf("store bundle %s: %w", strings.TrimSuffix(name, ".dgcase"), err)
		}
	}
	return nil
}
