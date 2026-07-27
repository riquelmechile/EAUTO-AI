# syntax=docker/dockerfile:1.7
FROM golang:1.24.8-bookworm AS builder
ARG MINIO_VERSION=RELEASE.2025-10-15T17-29-55Z
ENV GOBIN=/out CGO_ENABLED=0
RUN mkdir -p /out && go install -trimpath github.com/minio/minio@${MINIO_VERSION}

FROM gcr.io/distroless/base-debian12:nonroot
COPY --from=builder /out/minio /usr/local/bin/minio
USER nonroot:nonroot
EXPOSE 9000
ENTRYPOINT ["/usr/local/bin/minio"]
CMD ["server", "/data", "--address", ":9000"]
