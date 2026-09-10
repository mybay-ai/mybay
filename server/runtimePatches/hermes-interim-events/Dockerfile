ARG HERMES_BASE_IMAGE=nousresearch/hermes-agent:v2026.8.27
FROM ${HERMES_BASE_IMAGE}

COPY patch_api_server.py /tmp/mybay-patch-api-server.py
RUN python /tmp/mybay-patch-api-server.py /opt/hermes/gateway/platforms/api_server.py \
    && rm /tmp/mybay-patch-api-server.py
