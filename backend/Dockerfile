FROM golang:1.26-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o main ./cmd/api

FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata
RUN addgroup -S -g 1000 app && adduser -S -u 1000 -G app app

WORKDIR /app

COPY --from=builder /app/main .

RUN mkdir -p /app/uploads/avatars /app/uploads/chat && chown -R app:app /app/uploads

USER app

EXPOSE 8080

CMD ["./main"]
