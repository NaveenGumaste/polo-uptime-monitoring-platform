FROM golang:1.27.4-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/polo-probe .

FROM builder AS test
RUN apk add --no-cache gcc musl-dev
RUN go vet ./... && CGO_ENABLED=1 go test -race -cover ./...

FROM alpine:3.23
RUN apk add --no-cache ca-certificates && addgroup -S polo && adduser -S -G polo polo
WORKDIR /app
COPY --from=builder /out/polo-probe /app/polo-probe
USER polo
ENV LISTEN_ADDR=:8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
ENTRYPOINT ["/app/polo-probe"]
