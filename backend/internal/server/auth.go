package server

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

const (
	sessionCookie = "dg_session"
	sessionTTL    = 30 * 24 * time.Hour
)

type User struct {
	ID          string `json:"id"`
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	IsAdmin     bool   `json:"isAdmin"`
}

type ctxKey int

const (
	userKey ctxKey = iota
	teamKey
)

func currentUser(r *http.Request) *User {
	u, _ := r.Context().Value(userKey).(*User)
	return u
}

func (s *Server) loadUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		if err == nil && c.Value != "" {
			if u, err := s.userForSession(r.Context(), c.Value); err == nil {
				r = r.WithContext(context.WithValue(r.Context(), userKey, u))
			}
		}
		next.ServeHTTP(w, r)
	})
}

func requireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if currentUser(r) == nil {
			writeErr(w, errStatus(401, "please sign in"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u := currentUser(r); u == nil || !u.IsAdmin {
			writeErr(w, errForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) userForSession(ctx context.Context, token string) (*User, error) {
	id, err := s.rdb.Get(ctx, "sess:"+token).Result()
	if err != nil {
		return nil, err
	}
	var u User
	err = s.pool.QueryRow(ctx, `SELECT id, email, display_name, is_admin FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Email, &u.DisplayName, &u.IsAdmin)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (s *Server) startSession(ctx context.Context, w http.ResponseWriter, userID string) error {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	if err := s.rdb.Set(ctx, "sess:"+token, userID, sessionTTL).Err(); err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", HttpOnly: true,
		SameSite: http.SameSiteLaxMode, Secure: s.cfg.SecureCookie, MaxAge: int(sessionTTL.Seconds()),
	})
	return nil
}

type credentials struct {
	Email       string `json:"email"`
	DisplayName string `json:"displayName"`
	Password    string `json:"password"`
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	in.Email = strings.TrimSpace(in.Email)
	in.DisplayName = strings.TrimSpace(in.DisplayName)
	if _, err := mail.ParseAddress(in.Email); err != nil {
		writeErr(w, errStatus(400, "that doesn't look like an email address"))
		return
	}
	if n := utf8.RuneCountInString(in.DisplayName); n < 2 || n > 32 {
		writeErr(w, errStatus(400, "pick a detective name between 2 and 32 characters"))
		return
	}
	if len(in.Password) < 8 {
		writeErr(w, errStatus(400, "use a password of at least 8 characters"))
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(in.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, err)
		return
	}
	isAdmin := false
	for _, e := range s.cfg.AdminEmails {
		if strings.EqualFold(e, in.Email) {
			isAdmin = true
		}
	}
	var id string
	// The very first account administers the instance.
	err = s.pool.QueryRow(r.Context(), `
		INSERT INTO users (email, display_name, password_hash, is_admin)
		VALUES ($1, $2, $3, $4 OR NOT EXISTS (SELECT 1 FROM users))
		RETURNING id`, in.Email, in.DisplayName, string(hash), isAdmin).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			writeErr(w, errStatus(409, "an account with that email already exists"))
			return
		}
		writeErr(w, err)
		return
	}
	if err := s.startSession(r.Context(), w, id); err != nil {
		writeErr(w, err)
		return
	}
	u, _ := s.userByID(r.Context(), id)
	writeJSON(w, 201, u)
}

func (s *Server) userByID(ctx context.Context, id string) (*User, error) {
	var u User
	err := s.pool.QueryRow(ctx, `SELECT id, email, display_name, is_admin FROM users WHERE id = $1`, id).
		Scan(&u.ID, &u.Email, &u.DisplayName, &u.IsAdmin)
	return &u, err
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	// Throttle guessing: 10 failures per email per 15 minutes.
	limitKey := "loginfail:" + email
	if n, _ := s.rdb.Get(r.Context(), limitKey).Int(); n >= 10 {
		writeErr(w, errStatus(429, "too many attempts; try again in a few minutes"))
		return
	}
	var id, hash string
	err := s.pool.QueryRow(r.Context(), `SELECT id, password_hash FROM users WHERE lower(email) = $1`, email).Scan(&id, &hash)
	if err == nil {
		err = bcrypt.CompareHashAndPassword([]byte(hash), []byte(in.Password))
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) || errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
			pipe := s.rdb.TxPipeline()
			pipe.Incr(r.Context(), limitKey)
			pipe.Expire(r.Context(), limitKey, 15*time.Minute)
			_, _ = pipe.Exec(r.Context())
			writeErr(w, errStatus(401, "wrong email or password"))
			return
		}
		writeErr(w, err)
		return
	}
	s.rdb.Del(r.Context(), limitKey)
	if err := s.startSession(r.Context(), w, id); err != nil {
		writeErr(w, err)
		return
	}
	u, _ := s.userByID(r.Context(), id)
	writeJSON(w, 200, u)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(sessionCookie); err == nil {
		s.rdb.Del(r.Context(), "sess:"+c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true})
	w.WriteHeader(204)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	if u == nil {
		writeErr(w, errStatus(401, "not signed in"))
		return
	}
	writeJSON(w, 200, u)
}
