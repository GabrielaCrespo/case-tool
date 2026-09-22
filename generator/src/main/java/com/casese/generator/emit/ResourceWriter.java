package com.casese.generator.emit;

import com.casese.generator.java.Names;
import com.casese.generator.model.UmlClass;
import com.casese.generator.plan.Blueprint;
import com.casese.generator.plan.EntityPlan;
import com.casese.generator.plan.Link;
import java.text.Normalizer;
import java.util.Locale;

/**
 * Los archivos del proyecto generado que no son código Java: el {@code pom.xml}
 * que lo convierte en un proyecto Maven ejecutable, la configuración de
 * PostgreSQL y el README que explica qué salió del diagrama.
 */
final class ResourceWriter {

  /**
   * La versión de Spring Boot del proyecto generado. Es la misma con la que se
   * compila este generador, de modo que las dependencias que Maven necesita ya
   * están descargadas cuando llega el momento de comprobar que compila.
   */
  private static final String SPRING_BOOT = "3.4.1";

  private final Blueprint blueprint;

  ResourceWriter(Blueprint blueprint) {
    this.blueprint = blueprint;
  }

  String pom() {
    return """
        <?xml version="1.0" encoding="UTF-8"?>
        <project xmlns="http://maven.apache.org/POM/4.0.0"
                 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                 xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
          <modelVersion>4.0.0</modelVersion>

          <parent>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-parent</artifactId>
            <version>{springBoot}</version>
            <relativePath/>
          </parent>

          <groupId>{group}</groupId>
          <artifactId>{artifact}</artifactId>
          <version>0.0.1-SNAPSHOT</version>
          <name>{artifact}</name>
          <description>Backend generado por CASE-Tool a partir del diagrama «{diagram}»</description>

          <properties>
            <java.version>21</java.version>
            <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
          </properties>

          <dependencies>
            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-web</artifactId>
            </dependency>

            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-data-jpa</artifactId>
            </dependency>

            <!-- Comprueba lo que el diagrama marcó: obligatorios y longitudes. -->
            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-validation</artifactId>
            </dependency>

            <!-- /actuator/health: con qué se sabe que el backend ya arrancó. -->
            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-actuator</artifactId>
            </dependency>

            <dependency>
              <groupId>org.postgresql</groupId>
              <artifactId>postgresql</artifactId>
              <scope>runtime</scope>
            </dependency>

            <dependency>
              <groupId>org.springframework.boot</groupId>
              <artifactId>spring-boot-starter-test</artifactId>
              <scope>test</scope>
            </dependency>
          </dependencies>

          <build>
            <plugins>
              <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
              </plugin>
            </plugins>
          </build>
        </project>
        """
        .replace("{springBoot}", SPRING_BOOT)
        .replace("{group}", blueprint.basePackage())
        .replace("{artifact}", blueprint.artifactId())
        .replace("{diagram}", xml(blueprint.model().name()));
  }

  String applicationProperties() {
    return """
        # Backend generado por CASE-Tool (CU07) a partir del diagrama «{diagram}».
        spring.application.name={artifact}

        # ---------------------------------------------------------------- PostgreSQL
        # La base de datos debe existir antes de arrancar; las tablas las crea
        # Hibernate. Para apuntar a otra sin tocar este archivo basta con definir
        # las variables de entorno DB_URL, DB_USER y DB_PASSWORD.
        spring.datasource.url=${DB_URL:jdbc:postgresql://localhost:5432/{database}}
        spring.datasource.username=${DB_USER:postgres}
        spring.datasource.password=${DB_PASSWORD:postgres}
        spring.datasource.driver-class-name=org.postgresql.Driver

        # ---------------------------------------------------------------------- JPA
        # «update» crea y amplía las tablas a partir de las entidades, sin borrar
        # lo que ya haya. Para un despliegue de verdad conviene cambiarlo por
        # «validate» y llevar los cambios del esquema con migraciones.
        spring.jpa.hibernate.ddl-auto=update
        spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.PostgreSQLDialect
        spring.jpa.show-sql=true
        spring.jpa.properties.hibernate.format_sql=true

        # Las consultas se resuelven dentro del servicio, no mientras se escribe la
        # respuesta: así una relación perezosa no se carga sin que nadie lo pida.
        spring.jpa.open-in-view=false

        # --------------------------------------------------------------------- HTTP
        server.port=${PORT:8080}

        # Varios backends generados conviven detrás del mismo dominio, cada uno
        # bajo su propio prefijo. La aplicación lo sabe en vez de que el proxy se
        # lo recorte, y así las rutas que devuelve siguen siendo las buenas.
        # Vacío mientras se ejecuta en el portátil de quien lo descargó.
        server.servlet.context-path=${CONTEXT_PATH:}

        # Lo único que se publica de actuator: si está vivo. Es lo que mira
        # quien lo despliega para saber que ya terminó de arrancar.
        management.endpoints.web.exposure.include=health

        # Los orígenes desde los que se admiten peticiones los lee
        # CorsConfiguration de la variable CORS_ORIGINS.
        """
        .replace("{diagram}", blueprint.model().name())
        .replace("{artifact}", blueprint.artifactId())
        .replace("{database}", databaseName());
  }

  /**
   * La imagen del backend generado, en dos etapas.
   *
   * <p>La primera compila con Maven y la segunda se queda sólo con el jar sobre
   * un JRE, que es una imagen mucho más pequeña y sin herramientas de
   * construcción dentro. El {@code pom.xml} se copia y se resuelven las
   * dependencias antes que el código: mientras el pom no cambie, Docker
   * reutiliza esa capa y no vuelve a descargar medio Maven en cada generación.
   */
  String dockerfile() {
    return """
        # Generado por CASE-Tool (CU07) a partir del diagrama «{diagram}».
        FROM maven:3.9-eclipse-temurin-21 AS build
        WORKDIR /app
        COPY pom.xml .
        RUN mvn -B -q dependency:go-offline
        COPY src ./src
        RUN mvn -B -q package -DskipTests

        FROM eclipse-temurin:21-jre
        WORKDIR /app
        COPY --from=build /app/target/*.jar app.jar
        EXPOSE 8080
        ENTRYPOINT ["java", "-jar", "/app/app.jar"]
        """
        .replace("{diagram}", blueprint.model().name());
  }

  /**
   * Lo que no tiene que entrar en la imagen. {@code target/} son los .class de
   * una compilación anterior —la imagen compila de cero— y el .zip es el propio
   * proyecto empaquetado para descargar.
   */
  String dockerignore() {
    return """
        target/
        *.zip
        .git/
        """;
  }

  String readme() {
    StringBuilder out = new StringBuilder();

    out.append("# ").append(blueprint.artifactId()).append("\n\n");
    out.append("Backend Spring Boot generado por **CASE-Tool** a partir del diagrama de clases «")
        .append(blueprint.model().name())
        .append("».\n\n");
    out.append("""
        No se ha escrito a mano: cada entidad, cada relación y cada endpoint salen
        de lo que había dibujado en el lienzo. Se puede modificar libremente, pero
        téngase en cuenta que volver a generar desde el diagrama reescribe estos
        archivos.

        ## Cómo ponerlo en marcha

        Hace falta Java 21, Maven y un PostgreSQL en marcha.

        ```bash
        createdb {database}
        mvn spring-boot:run
        ```

        La base de datos tiene que existir; las tablas las crea Hibernate al
        arrancar. Si su PostgreSQL usa otro usuario, otra contraseña u otro puerto,
        se indica sin tocar ningún archivo:

        ```bash
        DB_URL=jdbc:postgresql://localhost:5432/otra DB_USER=usuario DB_PASSWORD=clave mvn spring-boot:run
        ```

        ## Con Docker, sin instalar nada

        ```bash
        docker build -t {database} .
        docker run -p 8080:8080 -e DB_URL=jdbc:postgresql://host.docker.internal:5432/{database} {database}
        ```

        ## Variables de entorno

        | Variable | Para qué | Por defecto |
        |---|---|---|
        | `DB_URL`, `DB_USER`, `DB_PASSWORD` | A qué PostgreSQL se conecta. | `localhost:5432/{database}`, `postgres`/`postgres` |
        | `PORT` | Puerto en el que escucha. | `8080` |
        | `CONTEXT_PATH` | Prefijo bajo el que responde, para convivir con otros backends tras un mismo dominio. | vacío |
        | `CORS_ORIGINS` | Desde qué orígenes se admiten peticiones. | `*` |

        ## Estructura

        | Carpeta | Qué contiene |
        |---|---|
        | `entity/` | Las clases UML, con sus columnas y sus relaciones JPA. |
        | `repository/` | Un repositorio de Spring Data por entidad. |
        | `service/` | Las reglas de negocio y el CRUD transaccional. |
        | `controller/` | La API REST. |

        """
        .replace("{database}", databaseName()));

    out.append(endpoints());
    out.append(entities());
    out.append(notes());

    return out.toString();
  }

  private String endpoints() {
    StringBuilder out =
        new StringBuilder(
            """
            ## API

            | Método | Ruta | Qué hace |
            |---|---|---|
            | GET | `/api/_meta` | Describe el modelo: entidades, campos, tipos y relaciones. |
            | GET | `/actuator/health` | Dice si ya arrancó. |

            `/api/_meta` es lo que lee la aplicación móvil de CASE-Tool para armar
            sus listas y sus formularios sin saber nada de este diagrama.

            """);
    boolean any = false;

    for (EntityPlan plan : blueprint.entities()) {
      if (!plan.needsCrud()) {
        continue;
      }
      any = true;
      String path = Names.restPath(plan.name());

      out.append("### ").append(plan.name()).append("\n\n");
      out.append("| Método | Ruta | Qué hace |\n|---|---|---|\n");
      out.append("| GET | `").append(path).append("` | Lista todos. |\n");
      out.append("| GET | `").append(path).append("/{id}` | Uno por su id. |\n");
      out.append("| POST | `").append(path).append("` | Crea uno. |\n");
      out.append("| PUT | `").append(path).append("/{id}` | Reemplaza uno. |\n");
      out.append("| DELETE | `").append(path).append("/{id}` | Lo borra. |\n\n");
    }

    if (!any) {
      out.append("El diagrama no tiene ninguna clase instanciable, así que no hay endpoints.\n\n");
    }
    return out.toString();
  }

  private String entities() {
    StringBuilder out = new StringBuilder("## Qué se generó de cada clase\n\n");

    for (EntityPlan plan : blueprint.entities()) {
      out.append("### ").append(plan.name());
      if (plan.isAbstract()) {
        out.append(" _(abstracta: sin repositorio ni endpoints)_");
      }
      out.append("\n\n");

      if (plan.parent() != null) {
        out.append("- Hereda de `").append(plan.parent().name()).append("`.\n");
      }
      for (UmlClass realized : plan.interfaces()) {
        out.append("- Implementa `").append(realized.name()).append("`.\n");
      }
      out.append("- Clave primaria `")
          .append(EntityPlan.ID_NAME)
          .append("` (")
          .append(EntityPlan.ID_TYPE.simpleName())
          .append(" autogenerada");
      if (!plan.declaresId()) {
        out.append(", heredada de `").append(plan.parent().name()).append("`");
      }
      out.append(").\n");
      for (Link link : plan.links()) {
        out.append("- `")
            .append(link.field())
            .append("`: ")
            .append(relation(link))
            .append(" `")
            .append(link.other().name())
            .append("`.\n");
      }
      out.append("\n");
    }

    for (UmlClass umlClass : blueprint.interfaces()) {
      out.append("### ").append(umlClass.name()).append("\n\nInterfaz Java.\n\n");
    }
    for (UmlClass umlClass : blueprint.enumerations()) {
      out.append("### ").append(umlClass.name()).append("\n\nEnumerado Java.\n\n");
    }
    for (UmlClass umlClass : blueprint.services()) {
      out.append("### ").append(umlClass.name()).append("\n\nServicio de Spring.\n\n");
    }
    return out.toString();
  }

  private static String relation(Link link) {
    return switch (link.kind()) {
      case MANY_TO_ONE -> "muchos a uno con";
      case ONE_TO_MANY -> "uno a muchos con";
      case ONE_TO_ONE_OWNER, ONE_TO_ONE_INVERSE -> "uno a uno con";
      case MANY_TO_MANY_OWNER, MANY_TO_MANY_INVERSE -> "muchos a muchos con";
    };
  }

  private String notes() {
    if (blueprint.notes().isEmpty()) {
      return "";
    }
    StringBuilder out = new StringBuilder("## Decisiones que conviene revisar\n\n");
    blueprint.notes().forEach(note -> out.append("- ").append(note).append("\n"));

    return out.append("\n").toString();
  }

  /** El nombre del diagrama convertido en un nombre de base de datos posible. */
  private String databaseName() {
    String plain =
        Normalizer.normalize(blueprint.model().name(), Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")
            .toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", "_")
            .replaceAll("^_+|_+$", "");

    return plain.isEmpty() ? "backend_generado" : plain;
  }

  private static String xml(String text) {
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;");
  }
}
