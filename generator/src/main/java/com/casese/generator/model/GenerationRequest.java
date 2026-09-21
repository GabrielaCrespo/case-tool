package com.casese.generator.model;

/**
 * Lo que el backend NestJS escribe en el archivo de entrada del generador: el
 * diagrama que hay que traducir y las decisiones del proyecto de salida.
 */
public record GenerationRequest(String basePackage, String artifactId, UmlModel diagram) {

  private static final String DEFAULT_PACKAGE = "com.casetool.generated";
  private static final String DEFAULT_ARTIFACT = "backend-generado";

  public String packageOrDefault() {
    return basePackage == null || basePackage.isBlank() ? DEFAULT_PACKAGE : basePackage;
  }

  public String artifactOrDefault() {
    return artifactId == null || artifactId.isBlank() ? DEFAULT_ARTIFACT : artifactId;
  }
}
