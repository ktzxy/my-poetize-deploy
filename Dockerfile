FROM openjdk:8-jre-alpine

RUN apk add --no-cache curl tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    rm -rf /var/cache/apk/*

WORKDIR /app

COPY backend/poetize-server.jar /app/app.jar

# 不再复制 frontend！

RUN mkdir -p /app/logs

EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8081/actuator/health || exit 1

ENTRYPOINT ["sh", "-c", "mkdir -p /app/resourceStorage/config /app/resourceStorage/static && java ${JAVA_OPTS:--Xms256m -Xmx512m} -Dserver.port=8081 -jar /app/app.jar"]