package com.casese.generator;

import com.casese.generator.emit.ProjectGenerator;
import com.casese.generator.model.GenerationRequest;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import org.springframework.boot.Banner;
import org.springframework.boot.CommandLineRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * CU07 — El generador, visto desde fuera.
 *
 * <pre>
 *   java -jar generator.jar modelo.json directorio-de-salida [informe.json]
 * </pre>
 *
 * <p>{@code modelo.json} es el diagrama tal como lo devuelve el backend NestJS.
 * En {@code directorio-de-salida} queda el proyecto Spring Boot completo, y en
 * {@code informe.json}, si se pide, el resumen de lo generado.
 *
 * <p>No levanta ningún servidor. Termina con código 0 si el proyecto quedó
 * escrito y con código 1 si algo impidió escribirlo, que es lo que el backend
 * mira para dar el trabajo por bueno o por fallido.
 */
@SpringBootApplication
public class GeneratorApplication implements CommandLineRunner {

  private static final String USAGE =
      "Uso: java -jar generator.jar <modelo.json> <directorio-de-salida> [informe.json]";

  public static void main(String[] args) {
    SpringApplication application = new SpringApplication(GeneratorApplication.class);
    application.setWebApplicationType(WebApplicationType.NONE);
    application.setBannerMode(Banner.Mode.OFF);
    application.setLogStartupInfo(false);

    int code;
    try (ConfigurableApplicationContext context = application.run(args)) {
      code = SpringApplication.exit(context);
    }
    System.exit(code);
  }

  @Override
  public void run(String... args) throws Exception {
    if (args.length < 2) {
      throw new IllegalArgumentException(USAGE);
    }

    Path model = Path.of(args[0]);
    Path output = Path.of(args[1]);

    if (!Files.isRegularFile(model)) {
      throw new IllegalArgumentException("No se encuentra el modelo: " + model.toAbsolutePath());
    }

    ObjectMapper mapper = mapper();
    GenerationRequest request = mapper.readValue(model.toFile(), GenerationRequest.class);

    if (request.diagram() == null) {
      throw new IllegalArgumentException("El modelo no trae ningún diagrama que generar.");
    }

    GenerationReport report = new ProjectGenerator(request).generate(output);

    if (args.length > 2) {
      mapper.writeValue(Path.of(args[2]).toFile(), report);
    }
    System.out.printf(
        "Generadas %d entidades y %d archivos en %s%n",
        report.entities(), report.files().size(), output.toAbsolutePath());
  }

  /**
   * El JSON del modelo viene en snake_case porque así lo tiene el backend, que
   * a su vez lo tiene así porque así están las columnas en PostgreSQL. Los
   * campos que el generador no usa —posiciones, tamaños, fechas— se ignoran en
   * lugar de dar error: el modelo es el mismo que dibuja el lienzo y trae cosas
   * que aquí no pintan nada.
   */
  private static ObjectMapper mapper() {
    return JsonMapper.builder()
        .propertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE)
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .enable(SerializationFeature.INDENT_OUTPUT)
        .build();
  }
}
