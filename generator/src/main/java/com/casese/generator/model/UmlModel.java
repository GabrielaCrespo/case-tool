package com.casese.generator.model;

import java.util.List;

/**
 * El diagrama tal como lo tiene guardado la herramienta.
 *
 * <p>Es una copia fiel de {@code FullDiagramResponse} del backend NestJS: los
 * mismos nombres de campo, en snake_case, para que el generador coma
 * directamente lo que devuelve {@code GET /diagrams/:id} sin que nadie tenga
 * que mantener un segundo formato. Lo que sobra —posiciones, tamaños, fechas—
 * simplemente se ignora al leer el JSON.
 */
public record UmlModel(
    String id,
    String name,
    String description,
    List<UmlClass> classes,
    List<UmlRelationship> relationships) {

  public UmlModel {
    classes = classes == null ? List.of() : List.copyOf(classes);
    relationships = relationships == null ? List.of() : List.copyOf(relationships);
  }
}
