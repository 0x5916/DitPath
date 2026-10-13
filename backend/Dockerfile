# syntax=docker/dockerfile:1.7

FROM golang:1.27.1-alpine AS builder
WORKDIR /src

# Needed for pulling private modules/certs in some environments.
RUN apk add --no-cache ca-certificates

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/opencw ./cmd/api-server

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app

COPY --from=builder /out/opencw /app/opencw

ENV GIN_MODE=release
EXPOSE 8080

ENTRYPOINT ["/app/opencw"]
