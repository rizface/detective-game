// Package cases embeds the case bundles that ship with the server.
//
// Files ending in .dgcase are sealed: their content is obfuscated so the
// story isn't spoiled by browsing the repository. Use `go run ./cmd/casepack`
// to seal, unseal or validate them.
package cases

import "embed"

//go:embed *.dgcase
var Bundles embed.FS
