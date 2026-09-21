package com.casese.generator.model;

/**
 * Una relación entre dos clases del diagrama.
 *
 * <p>Sobre la lectura de las multiplicidades, que es de donde sale toda la
 * cardinalidad del backend generado: cada una es la etiqueta dibujada en su
 * extremo, con el significado habitual en UML. En
 * {@code Cliente 1 ──── 0..* Factura} (origen Cliente, destino Factura),
 * {@code sourceMultiplicity} vale «1» y {@code targetMultiplicity} vale «0..*»,
 * y se lee «un Cliente tiene muchas Facturas, y cada Factura tiene un Cliente».
 * Es la misma convención que usa la herramienta al crear una clase de
 * asociación, de modo que lo que dibuja el usuario y lo que genera el backend
 * dicen lo mismo.
 */
public record UmlRelationship(
    String id,
    String sourceClassId,
    String targetClassId,
    String relationshipType,
    String sourceMultiplicity,
    String targetMultiplicity,
    String name,
    String sourceRole,
    String targetRole,
    boolean isNavigableSource,
    boolean isNavigableTarget) {

  /**
   * Multiplicidades que significan «muchos»: «*», «0..*», «1..*», «2..*».
   * Es la misma regla que aplica el validador del backend, para que lo que allí
   * se avisa como muchos-a-muchos sea exactamente lo que aquí se genera así.
   */
  public static boolean isMany(String multiplicity) {
    return multiplicity != null && (multiplicity.equals("*") || multiplicity.endsWith("..*"));
  }

  public boolean sourceIsMany() {
    return isMany(sourceMultiplicity);
  }

  public boolean targetIsMany() {
    return isMany(targetMultiplicity);
  }

  public boolean is(String type) {
    return type.equals(relationshipType);
  }

  /** Herencia y realización no son campos: cambian la declaración de la clase. */
  public boolean isStructural() {
    return is("INHERITANCE") || is("REALIZATION");
  }

  /**
   * Las que se convierten en campos con anotación JPA. Una dependencia no lo
   * es: dice que una clase usa a otra, no que guarde una referencia a ella.
   */
  public boolean isAssociation() {
    return is("ASSOCIATION") || is("AGGREGATION") || is("COMPOSITION");
  }

  /**
   * En una composición las partes no viven sin el todo, así que la colección se
   * genera con cascada y borrado de huérfanos.
   */
  public boolean isComposition() {
    return is("COMPOSITION");
  }
}
