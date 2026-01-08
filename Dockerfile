# 多阶段构建 - 前端构建阶段
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend

ENV NODE_OPTIONS="--openssl-legacy-provider"

# 为 alpine 安装所有必要的构建依赖（最小化安装）
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# 设置 npm 配置
RUN npm config set registry https://registry.npmmirror.com

# 复制前端项目文件
COPY poetize-ui/package*.json ./

# 清理 npm 缓存并安装依赖
RUN npm ci --only=production --verbose

COPY poetize-ui/ ./

# 构建前端项目
RUN npm run build

# 清理构建时的依赖（只保留运行时必需的）
RUN npm prune --production

# 多阶段构建 - 后端构建阶段
FROM maven:3.8-openjdk-8-slim AS backend-builder

WORKDIR /app/backend

# 复制 Maven 配置文件
COPY poetize-server/pom.xml ./
COPY poetize-server/poetry-web/pom.xml ./poetry-web/

# 下载依赖（利用 Docker 层缓存）
RUN mvn dependency:go-offline -B -q

# 复制后端源码并构建
COPY poetize-server/ ./
RUN mvn clean package -DskipTests -q -Dmaven.test.skip=true

# 清理构建缓存
RUN rm -rf ~/.m2/repository

# 最终运行阶段 - 使用更小的基础镜像
FROM eclipse-temurin:8-jre-alpine

# 安装必要工具（最小化安装）
RUN apk add --no-cache curl tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    rm -rf /var/cache/apk/*

WORKDIR /app

# 从构建阶段复制文件
COPY --from=backend-builder /app/backend/poetry-web/target/*.jar /app/app.jar
COPY --from=frontend-builder /app/frontend/dist /app/static

# 创建必要目录
RUN mkdir -p /app/resourceStorage/config \
    && mkdir -p /app/resourceStorage/static \
    && mkdir -p /app/logs

# 暴露端口
EXPOSE 8081

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:8081/actuator/health || exit 1

# 启动应用
ENTRYPOINT ["sh", "-c", "java ${JAVA_OPTS:--Xms256m -Xmx512m} -Djava.security.egd=file:/dev/./urandom -Dserver.port=8081 -jar /app/app.jar"]