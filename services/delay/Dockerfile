# Holds the network namespace that measurement applications join, and adds ΔRTT there.
FROM alpine:3
RUN apk add --no-cache iproute2
COPY --chmod=755 delay.sh /usr/local/bin/delay
CMD ["sleep", "infinity"]
