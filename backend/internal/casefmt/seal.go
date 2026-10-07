package casefmt

import (
	"bytes"
	"compress/gzip"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"gopkg.in/yaml.v3"
)

// Sealed bundles keep case content unreadable at a glance, so a case can be
// committed to a repository without spoiling it for anyone browsing files or
// diffs. This is spoiler protection, not security: the key is in this file.
const sealHeader = "DGCASE1\n"

var sealKey = sha256.Sum256([]byte("detective-game/sealed-case/v1 — no peeking, detective"))

// IsSealed reports whether data is a sealed bundle.
func IsSealed(data []byte) bool { return bytes.HasPrefix(data, []byte(sealHeader)) }

// Seal hashes the solution and packs the case into an obfuscated bundle.
func Seal(c *Case) ([]byte, error) {
	HashAnswers(c)
	raw, err := json.Marshal(c)
	if err != nil {
		return nil, err
	}
	var gz bytes.Buffer
	w := gzip.NewWriter(&gz)
	if _, err := w.Write(raw); err != nil {
		return nil, err
	}
	if err := w.Close(); err != nil {
		return nil, err
	}
	block, _ := aes.NewCipher(sealKey[:])
	aead, _ := cipher.NewGCM(block)
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	ct := aead.Seal(nonce, nonce, gz.Bytes(), nil)
	enc := base64.StdEncoding.EncodeToString(ct)
	var out strings.Builder
	out.WriteString(sealHeader)
	for len(enc) > 76 {
		out.WriteString(enc[:76] + "\n")
		enc = enc[76:]
	}
	out.WriteString(enc + "\n")
	return []byte(out.String()), nil
}

// Unseal reverses Seal.
func Unseal(data []byte) (*Case, error) {
	if !IsSealed(data) {
		return nil, errors.New("not a sealed case bundle")
	}
	enc := strings.Join(strings.Fields(string(data[len(sealHeader):])), "")
	ct, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return nil, fmt.Errorf("decode bundle: %w", err)
	}
	block, _ := aes.NewCipher(sealKey[:])
	aead, _ := cipher.NewGCM(block)
	if len(ct) < aead.NonceSize() {
		return nil, errors.New("bundle too short")
	}
	gzData, err := aead.Open(nil, ct[:aead.NonceSize()], ct[aead.NonceSize():], nil)
	if err != nil {
		return nil, fmt.Errorf("open bundle: %w", err)
	}
	r, err := gzip.NewReader(bytes.NewReader(gzData))
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, err
	}
	var c Case
	if err := json.Unmarshal(raw, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

// Load reads a case from a sealed bundle, JSON or YAML.
func Load(data []byte) (*Case, error) {
	if IsSealed(data) {
		return Unseal(data)
	}
	var c Case
	trimmed := bytes.TrimSpace(data)
	if len(trimmed) > 0 && trimmed[0] == '{' {
		if err := json.Unmarshal(trimmed, &c); err != nil {
			return nil, fmt.Errorf("parse json: %w", err)
		}
		return &c, nil
	}
	dec := yaml.NewDecoder(bytes.NewReader(data))
	dec.KnownFields(true)
	if err := dec.Decode(&c); err != nil {
		return nil, fmt.Errorf("parse yaml: %w", err)
	}
	return &c, nil
}

// HashAnswer returns the stored hash for an answer to a question.
func HashAnswer(salt, questionID, answer string) string {
	h := sha256.Sum256([]byte(salt + "|" + questionID + "|" + strings.TrimSpace(strings.ToLower(answer))))
	return hex.EncodeToString(h[:])
}

// HashAnswers replaces plain answers with hashes. Questions that already have a
// hash and no new plain answer keep their hash.
func HashAnswers(c *Case) {
	if c.Accusation.Salt == "" {
		b := make([]byte, 12)
		_, _ = rand.Read(b)
		c.Accusation.Salt = hex.EncodeToString(b)
	}
	for i := range c.Accusation.Questions {
		q := &c.Accusation.Questions[i]
		if q.Answer != "" {
			q.AnswerHash = HashAnswer(c.Accusation.Salt, q.ID, q.Answer)
			q.Answer = ""
		}
	}
}

// CheckAnswer reports whether answer is correct for q.
func CheckAnswer(c *Case, q Question, answer string) bool {
	if answer == "" || q.AnswerHash == "" {
		return false
	}
	return HashAnswer(c.Accusation.Salt, q.ID, answer) == q.AnswerHash
}
