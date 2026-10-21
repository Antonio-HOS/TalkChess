# TalkChess Dockerfile - Vite/React (estático) servido por Nginx com senha
FROM node:20-alpine AS base

# Instalar dependências necessárias
RUN apk add --no-cache libc6-compat

# Stage 1: Dependencies
FROM base AS deps
WORKDIR /app

# Copiar arquivos de dependências (o postinstall copia o Stockfish, então scripts/ é necessário)
COPY package.json package-lock.json* ./
COPY scripts ./scripts
RUN npm ci

# Stage 2: Builder
FROM base AS builder
WORKDIR /app

# Copiar dependências do stage anterior
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build da aplicação
ENV NODE_ENV=production
RUN npm run build

# Stage 3: Runner (Nginx sem root + autenticação por senha)
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runner

# openssl é usado para gerar o hash da senha na inicialização
USER root
RUN apk add --no-cache openssl

# Configuração do Nginx e script que cria o arquivo de senha
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-auth.sh /docker-entrypoint.d/40-auth.sh
RUN sed -i 's/\r$//' /docker-entrypoint.d/40-auth.sh && chmod +x /docker-entrypoint.d/40-auth.sh

# Copiar arquivos necessários
COPY --from=builder /app/dist /usr/share/nginx/html

# Mudar para usuário não-root
USER nginx

EXPOSE 3002

# Comando para iniciar a aplicação (padrão da imagem do Nginx)
CMD ["nginx", "-g", "daemon off;"]
