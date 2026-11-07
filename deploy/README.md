# Poner la herramienta en línea

Lo que hay aquí levanta la herramienta CASE en una sola instancia EC2: el
editor, su backend, un Traefik que resuelve el TLS, y un PostgreSQL que guarda
la base de la propia herramienta (`case_tool`) y las de los backends que la
herramienta genera y publica. Hasta noviembre de 2026 la base de la herramienta
estaba en Supabase; ese proyecto se perdió y desde entonces vive aquí.

Publicar no es un caso de uso. La numeración sigue siendo CU01–CU10; esto es
una operación de la herramienta y se documenta como tal.

## Lo que hace falta antes

1. **Una instancia EC2 `t3.medium` con Amazon Linux 2023 y 30 GB de disco.**
   Con 2 GB de memoria no entra construir con Maven, y por eso no vale una
   `t3.micro`.
2. **Un dominio apuntando a su IP elástica.** Hace falta de verdad, no es un
   adorno: Android bloquea el tráfico HTTP en claro, así que sin certificado la
   aplicación móvil de CU09 no puede hablar con ningún backend. Y Let's Encrypt
   no emite certificados para direcciones IP.
3. **El DNS resolviendo antes del primer arranque.** Traefik pide el
   certificado nada más levantarse, y si el dominio todavía no resuelve, falla
   y hay que reiniciarlo.

## Puesta en marcha

### 1. Preparar la instancia

Se entra por SSM, no por SSH: el puerto 22 está cerrado.

```bash
aws ssm start-session --target <id-de-la-instancia> --profile case-tool
```

Ya dentro:

```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ssm-user

# Docker Compose como complemento del cliente
sudo mkdir -p /usr/local/lib/docker/cli-plugins
sudo curl -sSL \
  https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Y buildx, que Compose necesita para construir. El Docker que trae Amazon
# Linux no lo incluye, y sin él `docker compose build` se queda en
# «compose build requires buildx 0.17.0 or later».
sudo curl -sSL \
  https://github.com/docker/buildx/releases/download/v0.19.3/buildx-v0.19.3.linux-amd64 \
  -o /usr/local/lib/docker/cli-plugins/docker-buildx
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx
```

Hay que salir y volver a entrar para que el grupo `docker` tenga efecto.

### 2. Traer el proyecto y configurarlo

```bash
git clone <el repositorio> case-tool
cd case-tool/deploy
cp .env.example .env
nano .env        # dominio, correo, JWT, Groq y la clave de PostgreSQL
```

Ese `.env` lleva credenciales de verdad y no se versiona.

### 3. Crear la base de la herramienta

Sólo la primera vez, o después de un `docker compose down -v`:

```bash
docker compose up -d postgres
docker exec case-tool-postgres createdb -U postgres case_tool
docker exec -i case-tool-postgres psql -U postgres -d case_tool -v ON_ERROR_STOP=1 \
  < ../database/db.sql
docker compose run --rm migrate   # RLS del contrato y firma de la base
```

El orden importa: `db.sql` crea las tablas y los triggers, y `migrate` añade lo
que el contrato de Prisma tiene y `db.sql` no —la RLS— y firma la base. Sin esa
firma el backend arranca, pero cada consulta falla con
`CONTRACT.MARKER_READ_FAILED`.

### 4. Levantarlo

```bash
docker compose up -d --build
docker compose logs -f traefik    # hasta ver el certificado emitido
```

La primera construcción tarda: la imagen del backend compila el generador Java
con Maven. Las siguientes reutilizan las capas.

### 5. Comprobar

```bash
curl -I https://<dominio>            # el editor
curl https://<dominio>/api           # el backend
```

## Cómo queda repartido el dominio

| Ruta | Quién responde |
|---|---|
| `https://<dominio>/` | El editor React. |
| `https://<dominio>/api/...` | El backend NestJS; Traefik le quita el `/api`. |
| `https://<dominio>/d/<slug>/...` | Un backend generado y publicado. |

Los `/d/<slug>` no están en este `docker-compose.yml`: los crea el backend al
publicar, uno por diagrama, y se enganchan a esta misma red con sus propias
etiquetas de Traefik. Por eso la red tiene un nombre fijo, `case-tool`: para
que un contenedor creado desde fuera de este archivo pueda unirse a ella.

A cada backend publicado se le dice bajo qué prefijo vive con `CONTEXT_PATH`,
y el proxy **no** se lo recorta. Es a propósito: la aplicación lo conoce, así
que las rutas que devuelve son correctas vistas desde fuera.

## Lo que cuesta montar el socket de Docker

El contenedor del backend tiene montado `/var/run/docker.sock`. Es lo que le
permite construir y arrancar los backends generados sin entrar a la máquina,
porque corre en ella.

**Montar ese socket equivale a dar root del anfitrión a ese contenedor.** Quien
pueda ejecutar órdenes dentro del backend puede crear un contenedor con el
disco de la instancia montado y hacer lo que quiera con él. No hay forma de
matizarlo: es así por cómo funciona el demonio de Docker.

Se acepta a sabiendas, en un proyecto de parcial y en una instancia dedicada a
esto. En algo de verdad se resolvería de otra manera —un servicio aparte con un
socket intermediado que sólo admita las órdenes concretas que hacen falta, o
construir las imágenes en otro sitio—, y quedaría escrito igual, porque lo que
no se puede es esconderlo.

Traefik también monta el socket, pero **sólo lectura**: necesita mirar qué
contenedores hay y con qué etiquetas, no crear ninguno.

## Lo que cuesta compartir el PostgreSQL

Desde que la base de la herramienta vive en el mismo PostgreSQL que las de los
backends publicados, conviene tener presentes dos cosas:

- **Cada backend publicado recibe las credenciales del superusuario**
  (`DEPLOY_DB_USER`), y un superusuario entra en cualquier base, también en
  `case_tool`, con sus usuarios y sus contraseñas cifradas. Mientras los
  backends publicados sean sólo los que genera la herramienta, eso no se usa;
  pero si uno de ellos tuviera un fallo explotable desde internet, el alcance
  ya no sería sólo su propia base. Se resolvería dándole a cada despliegue un
  rol propio, sin privilegios, dueño sólo de su base.
- **Los datos están sólo en el disco de la instancia.** No hay copias
  automáticas como las había en Supabase. Una instantánea del volumen antes de
  cualquier cambio arriesgado basta:

  ```bash
  aws ec2 create-snapshot --volume-id vol-0042e56ddb1cfb5a6 \
    --description "case-tool antes de ..." --profile case-tool --region us-east-1
  ```

## El despliegue de este proyecto

Se montó en septiembre de 2026, estuvo apagado desde el 30 de ese mes y se
volvió a levantar el 6 de noviembre, ya con la base de la herramienta en la
instancia:

| | |
|---|---|
| Dominio | `case-tool-gabriela.duckdns.org` |
| IP elástica | `3.226.42.207` |
| Instancia | `i-07342b49e34f874c0`, `c7i-flex.large` (2 vCPU, 4 GB), us-east-1 |
| Certificado | Let's Encrypt, se renueva solo |
| El proyecto vive en | `/opt/case-tool`, clonado de GitHub |

La instancia es una `c7i-flex.large` y no la `t3.medium` del plan porque la cuenta está en el
plan gratuito de AWS, que rechaza los tipos que no son elegibles. Tiene las mismas 2 vCPU y los
mismos 4 GB, que era el requisito de verdad.

Se entra con:

```bash
aws ssm start-session --target i-07342b49e34f874c0 --profile case-tool --region us-east-1
```

### Los secretos no están en el repositorio ni en el historial de órdenes

`deploy/.env` se arma en la propia instancia leyendo SSM Parameter Store, donde están guardados
como `SecureString`:

| Parámetro | Qué es |
|---|---|
| `/case-tool/JWT_SECRET` | Con qué se firman los tokens del servidor |
| `/case-tool/GROQ_API_KEY` | CU04 y CU05 |
| `/case-tool/DEPLOY_DB_PASSWORD` | El PostgreSQL de la instancia: la base de la herramienta y las de los backends publicados |

`/case-tool/DATABASE_URL` ya no se usa: era la cadena de Supabase, y ahora
`docker-compose.yml` arma la de la herramienta a partir de `DEPLOY_DB_*`.

El rol de la instancia (`case-tool-ec2`) sólo puede leer los parámetros bajo `/case-tool/`.
Para cambiar uno:

```bash
aws ssm put-parameter --name /case-tool/GROQ_API_KEY --type SecureString \
  --value 'la-nueva' --overwrite --profile case-tool --region us-east-1
# y después, en la instancia, rehacer deploy/.env y reiniciar:
#   sudo docker compose -f /opt/case-tool/deploy/docker-compose.yml up -d
```

## Memoria

La instancia tiene 4 GB. La herramienta ocupa alrededor de 1 GB entre el
backend, el editor, Traefik y PostgreSQL. Cada backend publicado ocupa entre
250 y 400 MB, de ahí que `MAX_DEPLOYMENTS` valga 3 por defecto. Subirlo es
posible, pero lo que pasa cuando no queda memoria es que el núcleo mata
procesos, y no avisa antes.

## Apagar y encender la instancia

La cuenta está en el plan gratuito de AWS, que funciona con crédito: encendida,
la instancia gasta unos 0,085 USD por hora (unos 61 al mes si no se apaga
nunca), y cuando el crédito se acaba AWS cierra la cuenta si no se ha pasado a
un plan de pago. Apagada sólo cuestan el disco y la IP, unos 6 USD al mes.

```bash
aws ec2 stop-instances  --instance-ids i-07342b49e34f874c0 --profile case-tool --region us-east-1
aws ec2 start-instances --instance-ids i-07342b49e34f874c0 --profile case-tool --region us-east-1
```

Al encenderla no hay que hacer nada más: todos los servicios, y también los
backends publicados, tienen `restart: unless-stopped` y vuelven solos. La IP
elástica sigue siendo la misma, así que el dominio no cambia.

## Volver a desplegar después de cambiar el código

```bash
git pull
docker compose up -d --build
```

Los backends ya publicados no se tocan: son contenedores independientes y
siguen corriendo. Se vuelven a publicar desde el editor si hace falta.

## Dar de baja todo

```bash
# Los backends publicados, que no los lleva compose
docker rm -f $(docker ps -aq --filter "name=case-backend-")

docker compose down            # deja los volúmenes
docker compose down -v         # borra también las bases y los certificados
```
