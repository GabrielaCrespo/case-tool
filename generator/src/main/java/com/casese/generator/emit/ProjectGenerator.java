package com.casese.generator.emit;

import com.casese.generator.GenerationReport;
import com.casese.generator.model.GenerationRequest;
import com.casese.generator.model.UmlClass;
import com.casese.generator.plan.Blueprint;
import com.casese.generator.plan.EntityPlan;
import com.squareup.javapoet.JavaFile;
import com.squareup.javapoet.TypeSpec;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * CU07 — Escribe el proyecto Spring Boot completo a partir del diagrama.
 *
 * <p>El resultado no es una carpeta de archivos Java sueltos: lleva su
 * {@code pom.xml}, su configuración de PostgreSQL y su clase de arranque, de
 * modo que lo que queda es un proyecto que se compila y se ejecuta con Maven
 * sin añadirle nada.
 */
public final class ProjectGenerator {

  private final Blueprint blueprint;
  private final List<String> written = new ArrayList<>();

  public ProjectGenerator(GenerationRequest request) {
    this.blueprint = new Blueprint(request);
  }

  public GenerationReport generate(Path output) throws IOException {
    Path sources = output.resolve("src/main/java");
    Files.createDirectories(sources);

    SupportWriter support = new SupportWriter(blueprint);
    EntityWriter entities = new EntityWriter(blueprint);
    CrudWriter crud = new CrudWriter(blueprint);

    java(sources, blueprint.basePackage(), support.application());
    java(sources, blueprint.basePackage(), support.cors());
    java(sources, blueprint.basePackage(), support.unknownReference());
    java(sources, blueprint.controllerPackage(), support.errors());

    // La descripción del modelo, que es lo que permite que una sola aplicación
    // móvil sirva para cualquier diagrama generado.
    java(sources, blueprint.controllerPackage(), new MetaWriter(blueprint).write());

    int endpoints = 0;
    for (EntityPlan plan : blueprint.entities()) {
      java(sources, blueprint.entityPackage(), entities.write(plan));

      // Una clase abstracta no se puede instanciar ni guardar: tener tabla sí
      // tiene, pero un repositorio suyo no lo podría usar nadie.
      if (plan.needsCrud()) {
        java(sources, blueprint.repositoryPackage(), crud.repository(plan));
        java(sources, blueprint.servicePackage(), crud.service(plan));
        java(sources, blueprint.controllerPackage(), crud.controller(plan));
        endpoints += 5;
      }
    }

    for (UmlClass umlClass : blueprint.interfaces()) {
      java(sources, blueprint.entityPackage(), support.anInterface(umlClass));
    }
    for (UmlClass umlClass : blueprint.enumerations()) {
      java(sources, blueprint.entityPackage(), support.anEnum(umlClass));
    }
    for (UmlClass umlClass : blueprint.services()) {
      java(sources, blueprint.servicePackage(), support.standaloneService(umlClass));
    }

    ResourceWriter resourceWriter = new ResourceWriter(blueprint);
    text(output, "pom.xml", resourceWriter.pom());
    text(output, "src/main/resources/application.properties", resourceWriter.applicationProperties());
    text(output, "README.md", resourceWriter.readme());

    // Con estos dos el proyecto se publica sin tener Java ni Maven instalados,
    // que es como lo despliega la herramienta y como lo probaría cualquiera.
    text(output, "Dockerfile", resourceWriter.dockerfile());
    text(output, ".dockerignore", resourceWriter.dockerignore());

    return new GenerationReport(
        blueprint.artifactId(),
        blueprint.basePackage(),
        blueprint.model().classes().size(),
        blueprint.entities().size(),
        endpoints,
        List.copyOf(written),
        blueprint.notes());
  }

  private void java(Path sources, String packageName, TypeSpec type) throws IOException {
    JavaFile file =
        JavaFile.builder(packageName, type)
            .addFileComment(
                "Generado por CASE-Tool (CU07) a partir del diagrama «$L».\n"
                    + "Los cambios que se hagan aquí se pierden al volver a generar.",
                blueprint.model().name())
            .indent("    ")
            .skipJavaLangImports(true)
            .build();

    file.writeTo(sources);
    written.add("src/main/java/" + packageName.replace('.', '/') + "/" + type.name + ".java");
  }

  /** {@code relativePath} va siempre con barras, como se ve en el README. */
  private void text(Path output, String relativePath, String content) throws IOException {
    Path file = output.resolve(relativePath);

    Files.createDirectories(file.getParent());
    Files.writeString(file, content, StandardCharsets.UTF_8);
    written.add(relativePath);
  }
}
