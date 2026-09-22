package com.casese.generator.java;

import com.squareup.javapoet.ClassName;
import com.squareup.javapoet.TypeName;
import java.util.Map;

/**
 * La traducción de los tipos del catálogo UML a tipos Java.
 *
 * <p>Es el reflejo de {@code DATA_TYPES} en {@code backend/src/diagrams/uml-catalog.ts},
 * que es donde se decide qué tipos puede llevar un atributo. Los dos listados
 * tienen que decir lo mismo: un tipo que allí se admita y aquí no exista sería
 * un atributo que el usuario puede guardar y el generador no sabe escribir.
 *
 * <p>Todos los tipos son envoltorios y no primitivas. Un {@code int} no puede
 * ser nulo, y una columna que admite nulos tiene que poder serlo.
 */
public final class JavaTypes {

  private JavaTypes() {}

  private static final ClassName STRING = ClassName.get(String.class);

  private static final Map<String, TypeName> CATALOG =
      Map.ofEntries(
          Map.entry("String", STRING),
          Map.entry("Integer", ClassName.get(Integer.class)),
          Map.entry("Long", ClassName.get(Long.class)),
          Map.entry("Double", ClassName.get(Double.class)),
          Map.entry("Float", ClassName.get(Float.class)),
          Map.entry("Boolean", ClassName.get(Boolean.class)),
          Map.entry("BigDecimal", ClassName.get("java.math", "BigDecimal")),
          Map.entry("LocalDate", ClassName.get("java.time", "LocalDate")),
          Map.entry("LocalDateTime", ClassName.get("java.time", "LocalDateTime")),
          Map.entry("UUID", ClassName.get("java.util", "UUID")),

          // Heredados del catálogo anterior del editor. Se siguen traduciendo
          // porque hay diagramas guardados que los usan.
          Map.entry("Text", STRING),
          Map.entry("Date", ClassName.get("java.time", "LocalDate")),
          Map.entry("DateTime", ClassName.get("java.time", "LocalDateTime")));

  public static boolean isCatalogType(String umlType) {
    return umlType != null && CATALOG.containsKey(umlType);
  }

  /** El tipo Java del catálogo, o {@code null} si no es uno de ellos. */
  public static TypeName of(String umlType) {
    return umlType == null ? null : CATALOG.get(umlType);
  }

  /**
   * Cuando el tipo de la columna no se deduce del tipo Java. «Text» es un
   * String sin longitud máxima, que en PostgreSQL es TEXT y no VARCHAR(255).
   */
  public static String columnDefinition(String umlType) {
    return "Text".equals(umlType) ? "TEXT" : null;
  }

  /**
   * Cuántos caracteres caben en la columna, o {@code null} si no hay tope.
   *
   * <p>Es el 255 que JPA da por defecto a un {@code String}, escrito aquí para
   * que lo digan lo mismo las tres cosas que dependen de él: la anotación
   * {@code @Size} de la entidad, el {@code maxLength} de {@code /api/_meta} y,
   * a través de él, el formulario de la aplicación móvil. «Text» no lo tiene
   * porque su columna es TEXT.
   */
  public static Integer maxLength(String umlType) {
    return "String".equals(umlType) ? 255 : null;
  }
}
