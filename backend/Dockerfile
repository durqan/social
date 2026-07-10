FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o main ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux go build -o video-import-worker ./cmd/video-import-worker
RUN CGO_ENABLED=0 GOOS=linux go build -o video-normalize-existing ./cmd/video-normalize-existing

FROM alpine:3.20

RUN apk add --no-cache \
  ca-certificates \
  tzdata \
  python3 \
  py3-pip \
  ffmpeg \
  nodejs \
  && python3 -m pip install --no-cache-dir --break-system-packages -U \
    "yt-dlp[default,curl-cffi]==2026.7.4" \
    "curl_cffi>=0.11"

RUN addgroup -S -g 1000 app && adduser -S -u 1000 -G app app

WORKDIR /app

COPY --from=builder /app/main .
COPY --from=builder /app/video-import-worker .
COPY --from=builder /app/video-normalize-existing .

RUN mkdir -p /app/uploads/avatars /app/uploads/chat /tmp/video-imports \
  && chown -R app:app /app/uploads /tmp/video-imports

USER app

EXPOSE 8080

CMD ["./main"]
