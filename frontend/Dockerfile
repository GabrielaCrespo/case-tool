# La herramienta CASE: el editor React.
#
# El contexto de construcción es la raíz del repositorio, igual que el del
# backend, para que las dos imágenes se armen con la misma orden:
#
#     docker build -f frontend/Dockerfile -t case-tool/web \
#       --build-arg VITE_API_URL=https://midominio/api .
#
# VITE_API_URL es un argumento de construcción y no una variable de entorno del
# contenedor, y tiene que serlo: Vite sustituye ese valor dentro del JavaScript
# al compilar, de modo que cuando el contenedor arranca ya no hay nada que
# configurar. Cambiar de dominio es volver a construir la imagen.

FROM node:22-alpine AS build
WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Lo que se publica son archivos estáticos. nginx sólo los sirve; de TLS y del
# dominio se encarga Traefik por delante.
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
