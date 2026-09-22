package com.casese.generator.model;

import java.util.List;

/**
 * Una clase del diagrama.
 *
 * <p>El estereotipo decide qué se genera. {@code entity} y la ausencia de
 * estereotipo producen una entidad JPA con sus cuatro capas; {@code interface}
 * produce una interfaz Java, {@code enumeration} un enum y {@code service} una
 * clase de servicio suelta. Una clase del lienzo nace sin estereotipo, y en un
 * diagrama de clases lo que se dibuja son las cosas que hay que guardar: por eso
 * «sin estereotipo» se trata como entidad y no se descarta.
 */
public record UmlClass(
    String id,
    String name,
    String stereotype,
    boolean isAbstract,
    String visibility,
    List<UmlAttribute> attributes,
    List<UmlMethod> methods) {

  public UmlClass {
    attributes = attributes == null ? List.of() : List.copyOf(attributes);
    methods = methods == null ? List.of() : List.copyOf(methods);
  }

  public boolean hasStereotype(String value) {
    return value.equals(stereotype);
  }

  /** Se convierte en tabla: lo pedido explícitamente, o una clase sin más. */
  public boolean isPersistent() {
    return stereotype == null || stereotype.isBlank() || hasStereotype("entity");
  }
}
