// Package server is the HTTP and WebSocket API: accounts, the case library,
// teams, gameplay, collaboration (notes, evidence board, chat), the final
// accusation and the case editor.
package server

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Config struct {
	Addr        string
	DatabaseURL string
	RedisURL    string
	StaticDir   string   // built frontend; served with SPA fallback
	AdminEmails []string // these accounts become admins; the first account always does
	SecureCookie bool
}

type Server struct {
	cfg   Config
	pool  *pgxpool.Pool
	rdb   *redis.Client
	cases *registry
	hub   *hub
}

func New(ctx context.Context, cfg Config, pool *pgxpool.Pool, rdb *redis.Client, bundles fs.FS) (*Server, error) {
	if err := syncBundles(ctx, pool, bundles); err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, pool: pool, rdb: rdb, cases: newRegistry(pool)}
	s.hub = newHub(rdb)
	go s.hub.run(ctx)
	return s, nil
}

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP, middleware.Recoverer, requestLogger)
	r.Use(s.loadUser)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]string{"status": "ok"}) })
		r.Post("/auth/register", s.register)
		r.Post("/auth/login", s.login)
		r.Post("/auth/logout", s.logout)
		r.Get("/me", s.me)

		r.Group(func(r chi.Router) {
			r.Use(requireUser)
			r.Get("/cases", s.listCases)
			r.Get("/cases/{slug}", s.getCase)

			r.Get("/teams", s.myTeams)
			r.Post("/teams", s.createTeam)
			r.Get("/join/{code}", s.previewInvite)
			r.Post("/join/{code}", s.joinTeam)

			r.Route("/teams/{teamID}", func(r chi.Router) {
				r.Use(s.requireMember)
				r.Get("/", s.snapshot)
				r.Get("/ws", s.websocket)
				r.Delete("/members/me", s.leaveTeam)
				r.Post("/travel", s.travel)
				r.Post("/ask", s.ask)
				r.Post("/search", s.search)
				r.Get("/events", s.events)

				r.Post("/notes", s.createNote)
				r.Patch("/notes/{noteID}", s.updateNote)
				r.Delete("/notes/{noteID}", s.deleteNote)

				r.Post("/board/items", s.createBoardItem)
				r.Patch("/board/items/{itemID}", s.updateBoardItem)
				r.Delete("/board/items/{itemID}", s.deleteBoardItem)
				r.Post("/board/links", s.createBoardLink)
				r.Patch("/board/links/{linkID}", s.updateBoardLink)
				r.Delete("/board/links/{linkID}", s.deleteBoardLink)

				r.Post("/chat", s.postChat)

				r.Put("/draft", s.updateDraft)
				r.Post("/draft/sign", s.signDraft)
				r.Post("/draft/unsign", s.unsignDraft)
				r.Post("/accuse", s.accuse)
			})

			r.Route("/admin", func(r chi.Router) {
				r.Use(requireAdmin)
				r.Get("/cases", s.adminListCases)
				r.Post("/cases", s.adminCreateCase)
				r.Post("/cases/import", s.adminImportCase)
				r.Post("/validate", s.adminValidateDraft)
				r.Get("/cases/{caseID}", s.adminGetCase)
				r.Put("/cases/{caseID}", s.adminSaveCase)
				r.Post("/cases/{caseID}/publish", s.adminPublish)
				r.Delete("/cases/{caseID}", s.adminDeleteCase)
			})
		})
	})

	if s.cfg.StaticDir != "" {
		r.Handle("/*", spa(s.cfg.StaticDir))
	}
	return r
}

// spa serves the built frontend and falls back to index.html for client routes.
func spa(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			if strings.HasPrefix(r.URL.Path, "/assets/") {
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			}
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		next.ServeHTTP(ww, r)
		if strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasSuffix(r.URL.Path, "/ws") {
			slog.Info("http", "method", r.Method, "path", r.URL.Path, "status", ww.Status(), "dur", time.Since(start).Round(time.Millisecond))
		}
	})
}

// apiError is an error with an HTTP status and a message safe to show players.
type apiError struct {
	status int
	msg    string
}

func (e *apiError) Error() string { return e.msg }

func errStatus(status int, msg string) error { return &apiError{status, msg} }

var (
	errNotFound  = errStatus(404, "not found")
	errForbidden = errStatus(403, "forbidden")
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	var ae *apiError
	if errors.As(err, &ae) {
		writeJSON(w, ae.status, map[string]string{"error": ae.msg})
		return
	}
	slog.Error("request failed", "err", err)
	writeJSON(w, 500, map[string]string{"error": "something went wrong"})
}

func decode(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 8<<20))
	if err := dec.Decode(v); err != nil {
		return errStatus(400, "invalid request body")
	}
	return nil
}
