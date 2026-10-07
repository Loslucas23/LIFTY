# Lifty en un servidor (modo nube): misma app, accesible desde cualquier lado.
# docker build -t lifty . && docker run -p 4321:4321 -v lifty-data:/data -e LIFTY_PASSWORD=algo-largo lifty
FROM node:22-alpine AS build
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/apps/server/dist ./
ENV LIFTY_DATA_DIR=/data PORT=4321 HOST=0.0.0.0
VOLUME /data
EXPOSE 4321
CMD ["node", "lifty-server.cjs"]
