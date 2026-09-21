package com.casese.generator.emit;

import com.casese.generator.model.UmlAttribute;
import com.squareup.javapoet.CodeBlock;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

/**
 * El valor por defecto de un atributo, escrito como inicialización del campo.
 *
 * <p>Se pone en el campo Java y no como DEFAULT de la columna porque así vale
 * también para los objetos que nunca llegan a guardarse, y porque es donde lo
 * vería quien lea la entidad. El editor ya comprueba que el valor case con el
 * tipo antes de guardarlo; aun así, un valor que no se pueda escribir se
 * descarta en lugar de romper la compilación.
 */
final class Defaults {

  private Defaults() {}

  static Optional<CodeBlock> initializer(UmlAttribute attribute) {
    String value = attribute.defaultValue();

    if (value == null || value.isBlank()) {
      return Optional.empty();
    }

    try {
      return Optional.ofNullable(
          switch (attribute.dataType()) {
            case "String", "Text" -> CodeBlock.of("$S", value);
            case "Integer" -> CodeBlock.of("$L", Integer.parseInt(value.trim()));
            case "Long" -> CodeBlock.of("$LL", Long.parseLong(value.trim()));
            case "Double" -> CodeBlock.of("$Ld", Double.parseDouble(value.trim()));
            case "Float" -> CodeBlock.of("$Lf", Float.parseFloat(value.trim()));
            case "Boolean" -> CodeBlock.of("$L", Boolean.parseBoolean(value.trim()));
            case "BigDecimal" ->
                CodeBlock.of("new $T($S)", BigDecimal.class, new BigDecimal(value.trim()));
            case "LocalDate", "Date" ->
                CodeBlock.of("$T.parse($S)", LocalDate.class, LocalDate.parse(value.trim()));
            case "LocalDateTime", "DateTime" ->
                CodeBlock.of(
                    "$T.parse($S)", LocalDateTime.class, LocalDateTime.parse(isoDateTime(value)));
            case "UUID" ->
                CodeBlock.of("$T.fromString($S)", UUID.class, UUID.fromString(value.trim()));
            default -> null;
          });
      // Se comprueba escribiéndolo: si el valor no se puede leer aquí, tampoco
      // se podría leer en el proyecto generado, y es mejor no ponerlo que
      // entregar un backend que falla al arrancar.
    } catch (RuntimeException malformed) {
      return Optional.empty();
    }
  }

  /** El editor admite «2026-01-31 09:30»; {@code LocalDateTime} exige la T. */
  private static String isoDateTime(String value) {
    return value.trim().replace(' ', 'T');
  }
}
