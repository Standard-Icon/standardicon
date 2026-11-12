FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
# docker-compose.yml picks which site this image shows: nginx.conf is the full site, and
# splash/nginx.conf shows only the /splash drawing page, at every path.
ARG NGINX_CONF=nginx.conf
RUN apk add --no-cache nodejs su-exec
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
COPY --from=build /app/out /usr/share/nginx/html
# The drawing page's saved icons, on the splash-data volume at /data.
WORKDIR /app
COPY splash/server.mjs splash/delete-icon.mjs splash/start.sh ./
RUN mkdir -p /data && chown 1000:1000 /data
ENV DATA_DIR=/data
EXPOSE 80
CMD ["sh", "/app/start.sh"]
