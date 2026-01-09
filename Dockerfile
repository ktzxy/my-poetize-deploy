# 使用轻量 JRE 镜像
FROM eclipse-temurin:8-jre-alpine

# 安装必要工具（curl 用于健康检查，tzdata 设置时区）
RUN apk add --no-cache curl tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# 复制后端 JAR（来自 backend/ 目录）
COPY backend/poetize-server.jar /app/app.jar

# 复制前端静态资源（来自 frontend/ 目录）
COPY frontend/ /app/static/

# 创建运行时所需目录（resourceStorage 在宿主机挂载，这里只需确保存在）
RUN mkdir -p /app/resourceStorage/config \
    && mkdir -p /app/resourceStorage/static \
    && mkdir -p /app/logs

# 暴露端口
EXPOSE 8081

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8081/actuator/health || exit 1

# 启动命令：配置 Spring Boot 从外部目录加载静态资源
ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS:--Xms256m -Xmx512m} -Djava.security.egd=file:/dev/./urandom -Dserver.port=8081 -Dspring.web.resources.static-locations=file:/app/static/,classpath:/static/ -jar /app/app.jar"]