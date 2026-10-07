# --- client ---------------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- server ---------------------------------------------------------------
FROM golang:1.24-alpine AS api
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/casepack ./cmd/casepack

# --- runtime --------------------------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H app
WORKDIR /app
COPY --from=api /out/server /out/casepack /app/
COPY --from=web /web/dist /app/web
ENV ADDR=:8080 STATIC_DIR=/app/web
USER app
EXPOSE 8080
ENTRYPOINT ["/app/server"]
