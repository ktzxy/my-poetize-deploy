#!/bin/bash

# 自动化构件分离部署脚本
# 该脚本将自动构建项目并将产物推送到对应的仓库

set -e  # 遇到错误立即退出

echo "开始构件分离部署流程..."

# 加载配置文件
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/deploy-config.conf"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "错误：配置文件不存在 $CONFIG_FILE"
    exit 1
fi

source "$CONFIG_FILE"

# 检查是否在源码仓库根目录
if [ ! -f "poetize-server/poetry-web/pom.xml" ]; then
    echo "错误：请在源码仓库根目录下运行此脚本"
    exit 1
fi

# 记录当前目录
ORIGINAL_DIR=$(pwd)

# 构建后端项目
echo "正在构建后端项目..."
eval $BUILD_COMMAND

# 构建前端项目
if [ -d "poetize-ui" ] && [ -f "poetize-ui/package.json" ]; then
    echo "正在构建前端项目..."
    cd poetize-ui
    npm run build
    cd ..
fi

# 回到原始目录
cd $ORIGINAL_DIR

# 检查JAR包是否生成
echo "检查JAR包是否生成：$JAR_FILE_PATH"
if [ ! -f "$JAR_FILE_PATH" ]; then
    echo "错误：JAR包未生成，请检查构建过程"
    echo "当前目录内容："
    pwd
    echo "检查目标路径是否存在："
    ls -la poetize-server/poetry-web/target/ | grep jar || echo "未找到jar文件"
    exit 1
fi

echo "JAR包已生成：$JAR_FILE_PATH"

# 检查部署仓库是否存在，不存在则克隆
if [ ! -d "$DEPLOY_REPO_LOCAL_PATH" ]; then
    echo "部署仓库不存在，正在克隆..."
    git clone $DEPLOY_REPO_URL $DEPLOY_REPO_LOCAL_PATH
fi

# 创建部署目录结构
mkdir -p $DEPLOY_REPO_LOCAL_PATH/backend
mkdir -p $DEPLOY_REPO_LOCAL_PATH/frontend
mkdir -p $DEPLOY_REPO_LOCAL_PATH/resources
mkdir -p $DEPLOY_REPO_LOCAL_PATH/database

# 复制后端JAR包
echo "正在复制后端JAR包到部署仓库..."
cp $JAR_FILE_PATH $DEPLOY_REPO_LOCAL_PATH/backend/

# 复制前端构建产物（如果存在）
if [ -d "poetize-ui/dist" ]; then
    echo "正在复制前端构建产物到部署仓库..."
    cp -r poetize-ui/dist/* $DEPLOY_REPO_LOCAL_PATH/frontend/ 2>/dev/null || true
fi

# 复制数据库脚本
if [ -d "poetize-server/sql" ]; then
    echo "正在复制数据库脚本到部署仓库..."
    cp -r poetize-server/sql/* $DEPLOY_REPO_LOCAL_PATH/database/ 2>/dev/null || true
elif [ -f "poetize-server/poetry-web/src/main/resources/db/poetize.sql" ]; then
    cp poetize-server/poetry-web/src/main/resources/db/poetize.sql $DEPLOY_REPO_LOCAL_PATH/database/ 2>/dev/null || true
fi

# 复制Docker相关文件
if [ -f "Dockerfile" ]; then
    cp Dockerfile $DEPLOY_REPO_LOCAL_PATH/ 2>/dev/null || true
fi

if [ -f "docker-compose-prod.yml" ]; then
    cp docker-compose-prod.yml $DEPLOY_REPO_LOCAL_PATH/ 2>/dev/null || true
elif [ -f "docker-compose.yml" ]; then
    cp docker-compose.yml $DEPLOY_REPO_LOCAL_PATH/ 2>/dev/null || true
fi

# 复制部署脚本
cp -r scripts/ $DEPLOY_REPO_LOCAL_PATH/ 2>/dev/null || true

# 推送部署仓库（如果启用）
if [ "$AUTO_PUSH_DEPLOY" = true ]; then
    echo "正在推送部署仓库..."
    cd $DEPLOY_REPO_LOCAL_PATH
    
    # 获取源码仓库的commit hash
    SOURCE_COMMIT_HASH=$(cd "$ORIGINAL_DIR" && git rev-parse HEAD)
    
    git add .
    COMMIT_MSG="Update deployment files $(date '+%Y-%m-%d %H:%M:%S')"
    COMMIT_DESC="Automatically generated from source commit: $SOURCE_COMMIT_HASH"
    git commit -m "$COMMIT_MSG" -m "$COMMIT_DESC" || echo "没有需要提交的更改"
    git push origin $DEPLOY_REPO_BRANCH
    cd - > /dev/null
else
    echo "跳过推送部署仓库（已禁用AUTO_PUSH_DEPLOY）"
fi

# 推送源码仓库（如果启用）
if [ "$AUTO_PUSH_SOURCE" = true ]; then
    echo "正在推送源码仓库..."
    git add .
    COMMIT_MSG="Update source code $(date '+%Y-%m-%d %H:%M:%S')"
    COMMIT_DESC="Corresponds to deployment in $DEPLOY_REPO_BRANCH branch of $DEPLOY_REPO_URL"
    git commit -m "$COMMIT_MSG" -m "$COMMIT_DESC" || echo "没有需要提交的更改"
    git push origin $SOURCE_REPO_BRANCH
else
    echo "跳过推送源码仓库（已禁用AUTO_PUSH_SOURCE）"
fi

echo "构件分离部署完成！"
echo "源码仓库已推送至：$SOURCE_REPO_URL"
echo "部署仓库已推送至：$DEPLOY_REPO_URL"