FROM postgres:17.10-alpine3.24
RUN apk add --no-cache bash restic rclone ca-certificates tzdata
COPY infra/backup/backup.sh /usr/local/bin/eauto-backup
COPY infra/backup/restore.sh /usr/local/bin/eauto-restore
RUN chmod 0755 /usr/local/bin/eauto-backup /usr/local/bin/eauto-restore
ENTRYPOINT ["/usr/local/bin/eauto-backup"]
