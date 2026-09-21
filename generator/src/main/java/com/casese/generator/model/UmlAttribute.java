package com.casese.generator.model;

/**
 * Un atributo de una clase, que será una columna de su tabla.
 *
 * <p>{@code dataType} puede llegar a nulo: la herramienta admite atributos a
 * medio describir, por ejemplo los que salen de leer la foto de una pizarra. El
 * validador del backend sólo deja generar cuando las entidades los tienen todos
 * resueltos, así que aquí un tipo nulo es un atributo que se omite en lugar de
 * una columna de tipo desconocido.
 */
public record UmlAttribute(
    String id,
    String name,
    String dataType,
    String visibility,
    boolean isPrimaryKey,
    boolean isNullable,
    boolean isUnique,
    String defaultValue,
    int orderIndex) {

  public boolean hasType() {
    return dataType != null && !dataType.isBlank();
  }
}
