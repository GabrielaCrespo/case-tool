package com.casese.generator.model;

import java.util.List;

/**
 * Una operación declarada en el diagrama.
 *
 * <p>El diagrama dice la firma, no lo que hace. El generador la escribe con un
 * cuerpo que lanza {@link UnsupportedOperationException}: así el proyecto
 * compila y arranca, y el método queda señalado como lo único que hay que
 * escribir a mano.
 */
public record UmlMethod(
    String id,
    String name,
    String returnType,
    String visibility,
    int orderIndex,
    List<UmlParameter> parameters) {

  public UmlMethod {
    parameters = parameters == null ? List.of() : List.copyOf(parameters);
  }
}
