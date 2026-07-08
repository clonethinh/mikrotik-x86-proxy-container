# Hub 3proxy — extends tarampampam/3proxy:2 with iproute2 + slot IP init
# Build: docker build --platform linux/amd64 -t webuiproxymikrotik/3proxy-hub:2 .
# Save:  docker save webuiproxymikrotik/3proxy-hub:2 -o 3proxy-hub.tar

FROM alpine:3.20

RUN apk add --no-cache iproute2

COPY --from=ghcr.io/tarampampam/3proxy:2 /bin/3proxy /bin/3proxy
COPY --from=ghcr.io/tarampampam/3proxy:2 /bin/lua /bin/lua
COPY --from=ghcr.io/tarampampam/3proxy:2 /bin/portcheck /bin/portcheck
COPY --from=ghcr.io/tarampampam/3proxy:2 /bin/dumb-init /bin/dumb-init
COPY --from=ghcr.io/tarampampam/3proxy:2 /entrypoint.lua /entrypoint.lua
COPY --from=ghcr.io/tarampampam/3proxy:2 /etc/3proxy /etc/3proxy
COPY --from=ghcr.io/tarampampam/3proxy:2 /etc/ssl /etc/ssl

COPY hub-entrypoint.sh /usr/local/bin/hub-entrypoint.sh
COPY hub-reload.sh /usr/local/bin/hub-reload.sh
RUN chmod +x /usr/local/bin/hub-entrypoint.sh /usr/local/bin/hub-reload.sh

ENV PROXY_PORT=3128
ENV SOCKS_PORT=1080

# root required for `ip addr add` slot aliases; 3proxy still binds per-slot -i
USER root

# 3proxy hub bind -i slot IP; kiểm tra port listen trên mọi interface
HEALTHCHECK --interval=10s --timeout=30s --start-period=5s CMD /bin/sh -c 'ss -tln | grep -q ":${PROXY_PORT:-20001} "'

ENTRYPOINT ["/bin/dumb-init", "--"]
CMD ["/bin/sh", "/usr/local/bin/hub-entrypoint.sh"]