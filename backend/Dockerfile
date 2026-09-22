# La herramienta CASE: el backend NestJS.
#
# El contexto de construcción es la raíz del repositorio y no esta carpeta,
# porque dentro de la imagen tiene que viajar también el generador de CU07, que
# vive en generator/. Se construye así:
#
#     docker build -f backend/Dockerfile -t case-tool/api .
#
# La imagen lleva más cosas que Node a propósito. El backend no escribe Java,
# pero sí lo ejecuta: llama al generador con `java -jar`, comprueba con Maven
# que lo generado compile, y construye y arranca con Docker los backends que se
# publican. Sin esas tres herramientas dentro, CU07 y la publicación no
# funcionan en el servidor aunque funcionen en un portátil.

# --------------------------------------------------------- el generador Java
FROM maven:3.9-eclipse-temurin-21 AS generator
WORKDIR /generator

# El pom primero: mientras no cambie, esta capa se reutiliza y Maven no vuelve
# a descargar sus dependencias en cada construcción.
COPY generator/pom.xml .
RUN mvn -B -q dependency:go-offline

COPY generator/src ./src
RUN mvn -B -q package -DskipTests

# ------------------------------------------------------- el backend compilado
FROM node:22-alpine AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
# `prisma skills sync` del postinstall necesita red y no hace falta para
# construir; sin él la imagen se arma igual.
RUN npm ci --ignore-scripts

COPY backend/ ./
RUN npm run build

# ------------------------------------------------------------ lo que se corre
FROM node:22-alpine

# openjdk para el generador, maven para comprobar que lo generado compila, y el
# cliente de Docker para publicar los backends generados. El demonio no está
# aquí: se usa el del anfitrión a través del socket que monta docker-compose.
RUN apk add --no-cache openjdk21-jre maven docker-cli

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /app/dist ./dist
COPY --from=generator /generator/target/generator.jar /opt/generator/generator.jar

ENV NODE_ENV=production
ENV GENERATOR_JAR=/opt/generator/generator.jar

# Un volumen, no la capa de la imagen: los proyectos generados tienen que
# sobrevivir a que la imagen se reconstruya.
ENV GENERATED_DIR=/data/generated
ENV PORT=3000

EXPOSE 3000
CMD ["node", "dist/main.js"]
