package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/rizface/detective-game/backend/cases"
	"github.com/rizface/detective-game/backend/internal/db"
	"github.com/rizface/detective-game/backend/internal/server"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))
	cfg := server.Config{
		Addr:         env("ADDR", ":8080"),
		DatabaseURL:  env("DATABASE_URL", "postgres://detective:detective@localhost:5432/detective?sslmode=disable"),
		RedisURL:     env("REDIS_URL", "redis://localhost:6379/0"),
		StaticDir:    env("STATIC_DIR", ""),
		SecureCookie: env("SECURE_COOKIES", "false") == "true",
	}
	for _, e := range strings.Split(env("ADMIN_EMAILS", ""), ",") {
		if e = strings.TrimSpace(e); e != "" {
			cfg.AdminEmails = append(cfg.AdminEmails, e)
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("database", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		slog.Error("migrate", "err", err)
		os.Exit(1)
	}

	opts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		slog.Error("redis url", "err", err)
		os.Exit(1)
	}
	rdb := redis.NewClient(opts)
	for i := 0; ; i++ {
		if err := rdb.Ping(ctx).Err(); err == nil {
			break
		} else if i == 30 {
			slog.Error("redis", "err", err)
			os.Exit(1)
		}
		time.Sleep(time.Second)
	}

	srv, err := server.New(ctx, cfg, pool, rdb, cases.Bundles)
	if err != nil {
		slog.Error("start", "err", err)
		os.Exit(1)
	}
	httpSrv := &http.Server{Addr: cfg.Addr, Handler: srv.Handler(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdown)
	}()
	slog.Info("listening", "addr", cfg.Addr)
	if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("http", "err", err)
		os.Exit(1)
	}
}
