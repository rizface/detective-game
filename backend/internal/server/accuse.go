package server

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// The final report is a shared draft. Any member can edit it (which clears all
// signatures); it can be filed once every member who is online has signed.

type Draft struct {
	Answers   map[string]string `json:"answers"`
	Signed    []string          `json:"signed"`
	UpdatedBy string            `json:"updatedBy,omitempty"`
	Version   int               `json:"version"`
}

type AttemptRow struct {
	Attempt         int       `json:"attempt"`
	RequiredCorrect int       `json:"requiredCorrect"`
	RequiredTotal   int       `json:"requiredTotal"`
	Passed          bool      `json:"passed"`
	SubmittedBy     *string   `json:"submittedBy"`
	CreatedAt       time.Time `json:"createdAt"`
}

func (s *Server) draft(ctx context.Context, teamID string) (Draft, error) {
	var raw []byte
	if err := s.pool.QueryRow(ctx, `SELECT draft FROM teams WHERE id = $1`, teamID).Scan(&raw); err != nil {
		return Draft{}, err
	}
	d := decodeJSON[Draft](raw)
	if d.Answers == nil {
		d.Answers = map[string]string{}
	}
	if d.Signed == nil {
		d.Signed = []string{}
	}
	return d, nil
}

func (s *Server) attempts(ctx context.Context, teamID string) ([]AttemptRow, error) {
	rows, err := s.pool.Query(ctx, `SELECT attempt, required_correct, required_total, passed, submitted_by, created_at
		FROM accusations WHERE team_id = $1 ORDER BY attempt`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AttemptRow{}
	for rows.Next() {
		var a AttemptRow
		if err := rows.Scan(&a.Attempt, &a.RequiredCorrect, &a.RequiredTotal, &a.Passed, &a.SubmittedBy, &a.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// mutateDraft applies fn to the draft under the team lock and broadcasts it.
func (s *Server) mutateDraft(w http.ResponseWriter, r *http.Request, fn func(l *loaded, d *Draft) error) {
	ctx := r.Context()
	u := currentUser(r)
	l, err := s.lockTeam(ctx, teamFrom(r))
	if err != nil {
		writeErr(w, err)
		return
	}
	defer l.tx.Rollback(ctx)
	if l.team.Status != "active" {
		writeErr(w, errStatus(409, "this case is closed"))
		return
	}
	var raw []byte
	if err := l.tx.QueryRow(ctx, `SELECT draft FROM teams WHERE id = $1`, l.team.ID).Scan(&raw); err != nil {
		writeErr(w, err)
		return
	}
	d := decodeJSON[Draft](raw)
	if d.Answers == nil {
		d.Answers = map[string]string{}
	}
	if d.Signed == nil {
		d.Signed = []string{}
	}
	if err := fn(l, &d); err != nil {
		writeErr(w, err)
		return
	}
	d.Version++
	out, _ := json.Marshal(d)
	if _, err := l.tx.Exec(ctx, `UPDATE teams SET draft = $2 WHERE id = $1`, l.team.ID, out); err != nil {
		writeErr(w, err)
		return
	}
	if err := l.tx.Commit(ctx); err != nil {
		writeErr(w, err)
		return
	}
	s.publish(ctx, l.team.ID, Event{Type: "draft", By: u.ID, Payload: d})
	writeJSON(w, 200, d)
}

func (s *Server) updateDraft(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Answers map[string]string `json:"answers"`
	}
	if err := decode(r, &in); err != nil {
		writeErr(w, err)
		return
	}
	s.mutateDraft(w, r, func(l *loaded, d *Draft) error {
		clean := map[string]string{}
		for _, q := range l.engine.Case.Accusation.Questions {
			v := in.Answers[q.ID]
			if v == "" {
				continue
			}
			switch q.Kind {
			case "person":
				if !l.state.Has("person", v) {
					return errStatus(422, "you can only name people you know about")
				}
			case "choice":
				ok := false
				for _, o := range q.Options {
					if o.ID == v {
						ok = true
					}
				}
				if !ok {
					return errStatus(422, "unknown option")
				}
			}
			clean[q.ID] = v
		}
		changed := len(clean) != len(d.Answers)
		for k, v := range clean {
			if d.Answers[k] != v {
				changed = true
			}
		}
		d.Answers = clean
		if changed {
			d.Signed = []string{}
			d.UpdatedBy = currentUser(r).ID
		}
		return nil
	})
}

func (s *Server) signDraft(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	s.mutateDraft(w, r, func(l *loaded, d *Draft) error {
		for _, id := range d.Signed {
			if id == u.ID {
				return nil
			}
		}
		d.Signed = append(d.Signed, u.ID)
		return nil
	})
}

func (s *Server) unsignDraft(w http.ResponseWriter, r *http.Request) {
	u := currentUser(r)
	s.mutateDraft(w, r, func(l *loaded, d *Draft) error {
		out := []string{}
		for _, id := range d.Signed {
			if id != u.ID {
				out = append(out, id)
			}
		}
		d.Signed = out
		return nil
	})
}

func (s *Server) accuse(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	u := currentUser(r)
	l, err := s.lockTeam(ctx, teamFrom(r))
	if err != nil {
		writeErr(w, err)
		return
	}
	defer l.tx.Rollback(ctx)
	if l.team.Status != "active" {
		writeErr(w, errStatus(409, "this case is closed"))
		return
	}
	if !l.engine.AccusationOpen(l.state) {
		writeErr(w, errStatus(409, "you aren't ready to file a report yet — keep investigating"))
		return
	}
	if l.team.AttemptsUsed >= l.team.MaxAttempts {
		writeErr(w, errStatus(409, "no attempts left"))
		return
	}
	var raw []byte
	if err := l.tx.QueryRow(ctx, `SELECT draft FROM teams WHERE id = $1`, l.team.ID).Scan(&raw); err != nil {
		writeErr(w, err)
		return
	}
	d := decodeJSON[Draft](raw)
	for _, q := range l.engine.Case.Accusation.Questions {
		if d.Answers[q.ID] == "" {
			writeErr(w, errStatus(422, "answer every question before filing"))
			return
		}
	}
	signed := map[string]bool{u.ID: true}
	for _, id := range d.Signed {
		signed[id] = true
	}
	for id := range s.online(ctx, l.team.ID) {
		if !signed[id] {
			writeErr(w, errStatus(409, "everyone who is online has to sign the report first"))
			return
		}
	}

	grade := l.engine.Grade(d.Answers)
	attempt := l.team.AttemptsUsed + 1
	answersJSON, _ := json.Marshal(d.Answers)
	if _, err := l.tx.Exec(ctx, `INSERT INTO accusations (team_id, attempt, answers, required_correct, required_total, points, passed, submitted_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, l.team.ID, attempt, answersJSON, grade.RequiredCorrect, grade.RequiredTotal, grade.Points, grade.Passed, u.ID); err != nil {
		writeErr(w, err)
		return
	}
	status := "active"
	var result *Result
	switch {
	case grade.Passed:
		status = "solved"
	case attempt >= l.team.MaxAttempts:
		status = "failed"
	}
	if status != "active" {
		result = buildResult(l.engine, l.state, status, d.Answers, attempt)
	}
	resultJSON, _ := json.Marshal(result)
	if result == nil {
		resultJSON = nil
	}
	d.Signed = []string{}
	d.Version++
	draftJSON, _ := json.Marshal(d)
	if _, err := l.tx.Exec(ctx, `UPDATE teams SET attempts_used = $2, status = $3, result = $4, draft = $5, updated_at = now(),
		finished_at = CASE WHEN $3 <> 'active' THEN now() END WHERE id = $1`,
		l.team.ID, attempt, status, resultJSON, draftJSON); err != nil {
		writeErr(w, err)
		return
	}
	payload := map[string]any{"attempt": attempt, "requiredCorrect": grade.RequiredCorrect, "requiredTotal": grade.RequiredTotal, "passed": grade.Passed}
	payloadJSON, _ := json.Marshal(payload)
	if _, err := l.tx.Exec(ctx, `INSERT INTO team_events (team_id, user_id, kind, payload, clock) VALUES ($1, $2, 'accusation', $3, $4)`,
		l.team.ID, u.ID, payloadJSON, l.state.Clock); err != nil {
		writeErr(w, err)
		return
	}
	if err := l.tx.Commit(ctx); err != nil {
		writeErr(w, err)
		return
	}
	resp := map[string]any{
		"attempt":         AttemptRow{Attempt: attempt, RequiredCorrect: grade.RequiredCorrect, RequiredTotal: grade.RequiredTotal, Passed: grade.Passed, SubmittedBy: &u.ID, CreatedAt: time.Now()},
		"status":          status,
		"attemptsUsed":    attempt,
		"result":          result,
		"draft":           d,
	}
	s.publish(ctx, l.team.ID, Event{Type: "accusation", By: u.ID, Payload: resp})
	writeJSON(w, 200, resp)
}
